import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAnalyticsUuid } from "../src/domain/analytics.js";
import type { PaymentStatus } from "../src/domain/payments.js";
import {
  buildPublicPaymentCapability,
  resolvePaymentServerConfig,
  type PaymentServerConfig,
} from "./paymentConfig.js";
import type { PaymentGateway } from "./paymentGateway.js";
import { PesepayGateway } from "./pesepayGateway.js";
import {
  applyVerifiedPaidPurchase,
  beginPaymentPurchase,
  getPaymentPurchase,
  getPaymentPurchaseForSession,
  markPaymentStatus,
  PaymentRepositoryError,
  recordGatewayCheckout,
  resolveCheckoutContext,
  type PaymentPurchase,
} from "./paymentRepository.js";

export type PaymentApiDependencies = {
  resolveConfig: (env: NodeJS.ProcessEnv) => PaymentServerConfig;
  createGateway: (config: PaymentServerConfig) => PaymentGateway;
  resolveCheckoutContext: typeof resolveCheckoutContext;
  beginPaymentPurchase: typeof beginPaymentPurchase;
  recordGatewayCheckout: typeof recordGatewayCheckout;
  getPaymentPurchase: typeof getPaymentPurchase;
  getPaymentPurchaseForSession: typeof getPaymentPurchaseForSession;
  markPaymentStatus: typeof markPaymentStatus;
  applyVerifiedPaidPurchase: typeof applyVerifiedPaidPurchase;
};

const defaultDependencies: PaymentApiDependencies = {
  resolveConfig: resolvePaymentServerConfig,
  createGateway: (config) => new PesepayGateway(config),
  resolveCheckoutContext,
  beginPaymentPurchase,
  recordGatewayCheckout,
  getPaymentPurchase,
  getPaymentPurchaseForSession,
  markPaymentStatus,
  applyVerifiedPaidPurchase,
};

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64 * 1024) throw new Error("Request body is too large.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getCookie(req: IncomingMessage, name: string) {
  const cookie = req.headers.cookie ?? "";
  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function anonymousSessionId(req: IncomingMessage) {
  const headerId = headerValue(req.headers["x-calenderzw-anonymous-id"]);
  if (isAnalyticsUuid(headerId)) return headerId;
  const cookieId = getCookie(req, "calenderzw_anon_session");
  return isAnalyticsUuid(cookieId) ? cookieId : null;
}

function apiError(res: ServerResponse, error: unknown) {
  if (error instanceof PaymentRepositoryError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message },
    });
    return;
  }
  console.warn("payment request failed", {
    code: error instanceof Error ? error.name : "UNKNOWN_PAYMENT_ERROR",
  });
  sendJson(res, 502, {
    error: {
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      message:
        "Payment checkout is temporarily unavailable. Please retry safely.",
    },
  });
}

function publicPurchaseState(
  purchase: PaymentPurchase,
  extra: { entitlement?: unknown } = {},
) {
  return {
    purchaseId: purchase.id,
    status: purchase.status,
    planCode: purchase.planCode,
    amountMinor: purchase.amountMinor,
    currency: purchase.currency,
    provider: purchase.provider,
    ...extra,
  };
}

export async function reconcilePaymentPurchase(
  purchase: PaymentPurchase,
  gateway: PaymentGateway,
  env: NodeJS.ProcessEnv,
  deps: PaymentApiDependencies = defaultDependencies,
) {
  if (purchase.status === "paid") return publicPurchaseState(purchase);
  if (!purchase.providerReference) return publicPurchaseState(purchase);

  const gatewayStatus = await gateway.getPaymentStatus(
    purchase.providerReference,
  );
  if (gatewayStatus.status === "paid") {
    const entitlement = await deps.applyVerifiedPaidPurchase(
      purchase,
      gatewayStatus.rawStatus,
      env,
    );
    return {
      ...publicPurchaseState({ ...purchase, status: "paid" }),
      entitlement,
    };
  }

  const nextStatus: Exclude<PaymentStatus, "paid"> = gatewayStatus.status;
  const updated = await deps.markPaymentStatus(
    purchase.id,
    {
      status: nextStatus,
      gatewayStatus: gatewayStatus.rawStatus,
      failureClass:
        nextStatus === "failed" || nextStatus === "cancelled"
          ? gatewayStatus.rawStatus
          : null,
    },
    env,
  );
  return publicPurchaseState(updated ?? { ...purchase, status: nextStatus });
}

async function paymentCapability(
  env: NodeJS.ProcessEnv,
  deps: PaymentApiDependencies,
) {
  const config = deps.resolveConfig(env);
  if (
    !config.integrationKey ||
    !config.encryptionKey ||
    config.mode === "disabled"
  ) {
    return buildPublicPaymentCapability(config);
  }
  try {
    const gateway = deps.createGateway(config);
    const methods = await gateway.listSupportedMethods(config.currency);
    return buildPublicPaymentCapability(config, methods);
  } catch {
    return buildPublicPaymentCapability(config);
  }
}

export async function handlePaymentRequest(
  req: IncomingMessage,
  res: ServerResponse,
  env: NodeJS.ProcessEnv = process.env,
  deps: PaymentApiDependencies = defaultDependencies,
) {
  const requestUrl = new URL(req.url ?? "/", "http://localhost");

  if (
    req.method === "GET" &&
    requestUrl.pathname === "/api/payments/capabilities"
  ) {
    sendJson(res, 200, await paymentCapability(env, deps));
    return true;
  }

  if (
    req.method === "POST" &&
    requestUrl.pathname === "/api/payments/checkout"
  ) {
    try {
      const config = deps.resolveConfig(env);
      if (!config.enabled || !config.publicAppUrl) {
        sendJson(res, 503, {
          error: {
            code: "CHECKOUT_NOT_AVAILABLE",
            message:
              "Paid checkout is not enabled. The current pilot remains available without payment.",
          },
          capability: buildPublicPaymentCapability(config),
        });
        return true;
      }
      const sessionId = anonymousSessionId(req);
      if (!sessionId) {
        sendJson(res, 401, {
          error: {
            code: "CALENDAR_SESSION_REQUIRED",
            message:
              "Create or open your calendar setup before starting payment.",
          },
        });
        return true;
      }
      const body = JSON.parse((await readBody(req)) || "{}") as {
        subscriptionId?: unknown;
        idempotencyKey?: unknown;
      };
      if (
        !isAnalyticsUuid(body.subscriptionId) ||
        !isAnalyticsUuid(body.idempotencyKey)
      ) {
        sendJson(res, 422, {
          error: {
            code: "VALIDATION_ERROR",
            message:
              "A valid subscription and checkout retry key are required.",
          },
        });
        return true;
      }

      const context = await deps.resolveCheckoutContext(
        body.subscriptionId,
        sessionId,
        env,
      );
      const merchantReference = `CZW-${randomUUID().replace(/-/g, "").slice(0, 20).toUpperCase()}`;
      const purchase = await deps.beginPaymentPurchase(
        {
          ...context,
          planCode: config.planCode,
          amountMinor: config.amountMinor,
          currency: config.currency,
          provider: "pesepay",
          merchantReference,
          idempotencyKey: body.idempotencyKey,
        },
        env,
      );

      if (purchase.status === "paid") {
        sendJson(res, 200, publicPurchaseState(purchase));
        return true;
      }
      if (purchase.providerReference) {
        const state = await reconcilePaymentPurchase(
          purchase,
          deps.createGateway(config),
          env,
          deps,
        );
        sendJson(res, 200, {
          ...state,
          retryable: true,
          message:
            "This checkout already exists. Its verified provider status was refreshed without creating a duplicate purchase.",
        });
        return true;
      }

      const gateway = deps.createGateway(config);
      const checkout = await gateway.createCheckout({
        merchantReference: purchase.merchantReference,
        amountMinor: purchase.amountMinor,
        currency: purchase.currency,
        reason: "CalenderZW Semester Pass",
        resultUrl: `${config.publicAppUrl}/api/payments/pesepay/result?purchaseId=${encodeURIComponent(purchase.id)}`,
        returnUrl: `${config.publicAppUrl}/find?payment=return&purchaseId=${encodeURIComponent(purchase.id)}`,
      });
      await deps.recordGatewayCheckout(
        {
          purchaseId: purchase.id,
          providerReference: checkout.providerReference,
          pollUrl: checkout.pollUrl,
          gatewayStatus: checkout.rawStatus,
        },
        env,
      );
      sendJson(res, 201, {
        ...publicPurchaseState(purchase),
        status: checkout.status,
        redirectUrl: checkout.redirectUrl,
      });
    } catch (error) {
      apiError(res, error);
    }
    return true;
  }

  if (req.method === "GET" && requestUrl.pathname === "/api/payments/status") {
    try {
      const sessionId = anonymousSessionId(req);
      const purchaseId = requestUrl.searchParams.get("purchaseId");
      if (!sessionId || !isAnalyticsUuid(purchaseId)) {
        sendJson(res, 404, {
          error: { code: "PURCHASE_NOT_FOUND", message: "Payment not found." },
        });
        return true;
      }
      const purchase = await deps.getPaymentPurchaseForSession(
        purchaseId,
        sessionId,
        env,
      );
      if (!purchase) {
        sendJson(res, 404, {
          error: { code: "PURCHASE_NOT_FOUND", message: "Payment not found." },
        });
        return true;
      }
      const config = deps.resolveConfig(env);
      const state = await reconcilePaymentPurchase(
        purchase,
        deps.createGateway(config),
        env,
        deps,
      );
      sendJson(res, 200, state);
    } catch (error) {
      apiError(res, error);
    }
    return true;
  }

  if (
    (req.method === "POST" || req.method === "GET") &&
    requestUrl.pathname === "/api/payments/pesepay/result"
  ) {
    try {
      const purchaseId = requestUrl.searchParams.get("purchaseId");
      if (!isAnalyticsUuid(purchaseId)) {
        sendJson(res, 404, {
          error: { code: "PURCHASE_NOT_FOUND", message: "Payment not found." },
        });
        return true;
      }
      const purchase = await deps.getPaymentPurchase(purchaseId, env);
      if (!purchase) {
        sendJson(res, 404, {
          error: { code: "PURCHASE_NOT_FOUND", message: "Payment not found." },
        });
        return true;
      }
      const config = deps.resolveConfig(env);
      const state = await reconcilePaymentPurchase(
        purchase,
        deps.createGateway(config),
        env,
        deps,
      );
      sendJson(res, 200, {
        ok: true,
        status: state.status,
      });
    } catch (error) {
      apiError(res, error);
    }
    return true;
  }

  return false;
}
