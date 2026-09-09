import { describe, expect, it, vi } from "vitest";
import {
  reconcilePaymentPurchase,
  type PaymentApiDependencies,
} from "../server/paymentApi";
import type { PaymentGateway } from "../server/paymentGateway";
import type { PaymentPurchase } from "../server/paymentRepository";

const purchase: PaymentPurchase = {
  id: "10000000-0000-4000-8000-000000000001",
  subscriptionId: "10000000-0000-4000-8000-000000000002",
  subscriberProfileId: "10000000-0000-4000-8000-000000000003",
  timetableId: "10000000-0000-4000-8000-000000000004",
  academicPeriodId: "10000000-0000-4000-8000-000000000005",
  planCode: "semester_pass",
  amountMinor: 300,
  currency: "USD",
  provider: "pesepay",
  merchantReference: "CZW-TEST",
  idempotencyKey: "10000000-0000-4000-8000-000000000006",
  providerReference: "P-REF-1",
  providerPollUrl: null,
  status: "pending",
  gatewayStatus: "INITIATED",
  failureClass: null,
};

function deps() {
  return {
    resolveConfig: vi.fn(),
    createGateway: vi.fn(),
    resolveCheckoutContext: vi.fn(),
    beginPaymentPurchase: vi.fn(),
    recordGatewayCheckout: vi.fn(),
    getPaymentPurchase: vi.fn(),
    getPaymentPurchaseForSession: vi.fn(),
    markPaymentStatus: vi.fn(async (_id, state) => ({
      ...purchase,
      status: state.status,
    })),
    applyVerifiedPaidPurchase: vi.fn(async () => ({
      entitlementId: "ent-1",
      status: "active",
      startsOn: "2026-08-01",
      endsOn: "2026-12-31",
    })),
  } as unknown as PaymentApiDependencies;
}

function gateway(
  status: "pending" | "paid" | "failed" | "cancelled",
): PaymentGateway {
  return {
    provider: "pesepay",
    createCheckout: vi.fn(),
    listSupportedMethods: vi.fn(),
    getPaymentStatus: vi.fn(async () => ({
      providerReference: "P-REF-1",
      rawStatus:
        status === "paid"
          ? "SUCCESS"
          : status === "failed"
            ? "AUTHORIZATION_FAILED"
            : status.toUpperCase(),
      status,
    })),
  };
}

describe("payment reconciliation", () => {
  it("creates entitlement only after a server-verified paid status", async () => {
    const dependencies = deps();
    const result = await reconcilePaymentPurchase(
      purchase,
      gateway("paid"),
      {} as NodeJS.ProcessEnv,
      dependencies,
    );
    expect(result.status).toBe("paid");
    expect(dependencies.applyVerifiedPaidPurchase).toHaveBeenCalledTimes(1);
    expect(dependencies.markPaymentStatus).not.toHaveBeenCalled();
  });

  it("keeps a pending sandbox payment pending without granting access", async () => {
    const dependencies = deps();
    const result = await reconcilePaymentPurchase(
      purchase,
      gateway("pending"),
      {} as NodeJS.ProcessEnv,
      dependencies,
    );
    expect(result.status).toBe("pending");
    expect(dependencies.markPaymentStatus).toHaveBeenCalledWith(
      purchase.id,
      expect.objectContaining({ status: "pending" }),
      expect.anything(),
    );
    expect(dependencies.applyVerifiedPaidPurchase).not.toHaveBeenCalled();
  });

  it("records failure without entitlement and is safe after a duplicate paid callback", async () => {
    const failedDeps = deps();
    const failed = await reconcilePaymentPurchase(
      purchase,
      gateway("failed"),
      {} as NodeJS.ProcessEnv,
      failedDeps,
    );
    expect(failed.status).toBe("failed");
    expect(failedDeps.applyVerifiedPaidPurchase).not.toHaveBeenCalled();

    const paidDeps = deps();
    const alreadyPaid = { ...purchase, status: "paid" as const };
    const provider = gateway("paid");
    const duplicate = await reconcilePaymentPurchase(
      alreadyPaid,
      provider,
      {} as NodeJS.ProcessEnv,
      paidDeps,
    );
    expect(duplicate.status).toBe("paid");
    expect(provider.getPaymentStatus).not.toHaveBeenCalled();
    expect(paidDeps.applyVerifiedPaidPurchase).not.toHaveBeenCalled();
  });
});
