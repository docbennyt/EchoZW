import { createHash } from "node:crypto";
import {
  sanitizePaymentFailureClass,
  type PaymentStatus,
} from "../src/domain/payments.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;

type CheckoutContext = {
  subscriptionId: string;
  subscriberProfileId: string;
  timetableId: string;
  academicPeriodId: string;
};

export type PaymentPurchase = {
  id: string;
  subscriptionId: string;
  subscriberProfileId: string;
  timetableId: string;
  academicPeriodId: string;
  planCode: string;
  amountMinor: number;
  currency: string;
  provider: "pesepay";
  merchantReference: string;
  idempotencyKey: string;
  providerReference: string | null;
  providerPollUrl: string | null;
  status: PaymentStatus;
  gatewayStatus: string | null;
  failureClass: string | null;
};

export class PaymentRepositoryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
  ) {
    super(message);
  }
}

function client(env: NodeJS.ProcessEnv) {
  return createSupabaseAdminClient(env);
}

function mapPurchase(row: JsonRecord): PaymentPurchase {
  return {
    id: String(row.id),
    subscriptionId: String(row.calendar_subscription_id),
    subscriberProfileId: String(row.subscriber_profile_id),
    timetableId: String(row.timetable_id),
    academicPeriodId: String(row.academic_period_id),
    planCode: String(row.plan_code),
    amountMinor: Number(row.amount_minor),
    currency: String(row.currency),
    provider: "pesepay",
    merchantReference: String(row.merchant_reference),
    idempotencyKey: String(row.idempotency_key),
    providerReference: row.provider_reference
      ? String(row.provider_reference)
      : null,
    providerPollUrl: row.provider_poll_url
      ? String(row.provider_poll_url)
      : null,
    status: String(row.status) as PaymentStatus,
    gatewayStatus: row.gateway_status ? String(row.gateway_status) : null,
    failureClass: row.failure_class ? String(row.failure_class) : null,
  };
}

function mapRepositoryError(
  error: { message?: string } | null,
  fallback: string,
) {
  const message = error?.message ?? fallback;
  if (message.includes("SUBSCRIPTION_NOT_FOUND")) {
    return new PaymentRepositoryError(
      "SUBSCRIPTION_NOT_FOUND",
      "Calendar subscription not found.",
      404,
    );
  }
  if (message.includes("SUBSCRIPTION_OWNERSHIP_MISMATCH")) {
    return new PaymentRepositoryError(
      "SUBSCRIPTION_OWNERSHIP_MISMATCH",
      "This calendar subscription does not belong to this browser session.",
      403,
    );
  }
  if (message.includes("IDEMPOTENCY_KEY_REUSED")) {
    return new PaymentRepositoryError(
      "IDEMPOTENCY_KEY_REUSED",
      "This checkout retry key was already used for different payment details.",
      409,
    );
  }
  if (message.includes("ENTITLEMENT_ALREADY_ACTIVE")) {
    return new PaymentRepositoryError(
      "ENTITLEMENT_ALREADY_ACTIVE",
      "Semester access is already active for this timetable.",
      409,
    );
  }
  return new PaymentRepositoryError(
    "PAYMENT_DATABASE_UNAVAILABLE",
    fallback,
    503,
  );
}

function singleRecord(data: unknown): JsonRecord | null {
  if (!data) return null;
  if (Array.isArray(data)) return (data[0] as JsonRecord | undefined) ?? null;
  return data as JsonRecord;
}

export async function resolveCheckoutContext(
  subscriptionId: string,
  anonymousSessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CheckoutContext> {
  const admin = client(env);
  const profileResult = await admin.rpc(
    "ensure_calendar_subscription_profile",
    {
      p_subscription_id: subscriptionId,
      p_anonymous_session_id: anonymousSessionId,
    },
  );
  if (profileResult.error || !profileResult.data) {
    throw mapRepositoryError(
      profileResult.error,
      "Could not bind this calendar subscription to a payment profile.",
    );
  }
  const subscriberProfileId = String(profileResult.data);

  const subscriptionResult = await admin
    .from("calendar_subscriptions")
    .select("id, timetable_id, subscriber_profile_id, revoked_at")
    .eq("id", subscriptionId)
    .maybeSingle();
  if (subscriptionResult.error || !subscriptionResult.data) {
    throw mapRepositoryError(
      subscriptionResult.error,
      "Could not load the calendar subscription for checkout.",
    );
  }
  if (subscriptionResult.data.revoked_at) {
    throw new PaymentRepositoryError(
      "SUBSCRIPTION_NOT_FOUND",
      "Calendar subscription not found.",
      404,
    );
  }

  const timetableId = String(subscriptionResult.data.timetable_id);
  const timetableResult = await admin
    .from("timetables")
    .select("id, academic_period_id")
    .eq("id", timetableId)
    .maybeSingle();
  if (timetableResult.error || !timetableResult.data?.academic_period_id) {
    throw new PaymentRepositoryError(
      "ACADEMIC_PERIOD_REQUIRED",
      "This timetable is not linked to an academic period.",
      409,
    );
  }

  return {
    subscriptionId,
    subscriberProfileId,
    timetableId,
    academicPeriodId: String(timetableResult.data.academic_period_id),
  };
}

export async function beginPaymentPurchase(
  input: CheckoutContext & {
    planCode: string;
    amountMinor: number;
    currency: string;
    provider: "pesepay";
    merchantReference: string;
    idempotencyKey: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await client(env).rpc("begin_payment_purchase", {
    p_calendar_subscription_id: input.subscriptionId,
    p_subscriber_profile_id: input.subscriberProfileId,
    p_timetable_id: input.timetableId,
    p_academic_period_id: input.academicPeriodId,
    p_plan_code: input.planCode,
    p_amount_minor: input.amountMinor,
    p_currency: input.currency,
    p_provider: input.provider,
    p_merchant_reference: input.merchantReference,
    p_idempotency_key: input.idempotencyKey,
  });
  const row = singleRecord(result.data);
  if (result.error || !row) {
    throw mapRepositoryError(result.error, "Could not begin payment checkout.");
  }
  return mapPurchase(row);
}

export async function recordGatewayCheckout(
  input: {
    purchaseId: string;
    providerReference: string;
    pollUrl: string | null;
    gatewayStatus: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await client(env).rpc("record_payment_gateway_checkout", {
    p_purchase_id: input.purchaseId,
    p_provider_reference: input.providerReference,
    p_poll_url: input.pollUrl,
    p_gateway_status: input.gatewayStatus,
  });
  const row = singleRecord(result.data);
  if (result.error || !row) {
    throw mapRepositoryError(
      result.error,
      "Could not save payment gateway checkout state.",
    );
  }
  return mapPurchase(row);
}

export async function getPaymentPurchase(
  purchaseId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await client(env)
    .from("payment_purchases")
    .select("*")
    .eq("id", purchaseId)
    .maybeSingle();
  if (result.error) {
    throw mapRepositoryError(result.error, "Could not load payment status.");
  }
  return result.data ? mapPurchase(result.data as JsonRecord) : null;
}

export async function getPaymentPurchaseForSession(
  purchaseId: string,
  anonymousSessionId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const purchase = await getPaymentPurchase(purchaseId, env);
  if (!purchase) return null;
  const result = await client(env)
    .from("calendar_subscriptions")
    .select("anonymous_session_id")
    .eq("id", purchase.subscriptionId)
    .maybeSingle();
  if (result.error || !result.data) {
    throw mapRepositoryError(
      result.error,
      "Could not verify payment ownership.",
    );
  }
  return String(result.data.anonymous_session_id) === anonymousSessionId
    ? purchase
    : null;
}

export async function markPaymentStatus(
  purchaseId: string,
  input: {
    status: Exclude<PaymentStatus, "paid">;
    gatewayStatus: string;
    failureClass?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const result = await client(env)
    .from("payment_purchases")
    .update({
      status: input.status,
      gateway_status: input.gatewayStatus,
      failure_class:
        input.status === "pending"
          ? null
          : sanitizePaymentFailureClass(
              input.failureClass ?? input.gatewayStatus,
            ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", purchaseId)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();
  if (result.error) {
    throw mapRepositoryError(result.error, "Could not update payment status.");
  }
  return result.data
    ? mapPurchase(result.data as JsonRecord)
    : getPaymentPurchase(purchaseId, env);
}

export async function applyVerifiedPaidPurchase(
  purchase: PaymentPurchase,
  gatewayStatus: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (!purchase.providerReference) {
    throw new PaymentRepositoryError(
      "PROVIDER_REFERENCE_REQUIRED",
      "Payment provider reference is missing.",
      409,
    );
  }
  const fingerprint = createHash("sha256")
    .update(`${purchase.provider}:${purchase.providerReference}:paid`)
    .digest("hex");
  const result = await client(env).rpc("apply_verified_payment", {
    p_purchase_id: purchase.id,
    p_provider_reference: purchase.providerReference,
    p_gateway_status: gatewayStatus,
    p_event_fingerprint: fingerprint,
  });
  if (result.error || !result.data) {
    throw mapRepositoryError(
      result.error,
      "Could not create verified semester entitlement.",
    );
  }
  const row = singleRecord(result.data)!;
  return {
    entitlementId: String(row.id),
    status: String(row.status),
    startsOn: String(row.starts_on),
    endsOn: String(row.ends_on),
  };
}
