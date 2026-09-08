import { describe, expect, it } from "vitest";
import {
  formatPlanPrice,
  normalizeGatewayPaymentStatus,
  paymentMethodFamiliesFromGateway,
} from "../src/domain/payments";

describe("payment domain", () => {
  it("fails closed on unknown statuses and grants only known paid states", () => {
    expect(normalizeGatewayPaymentStatus("SUCCESS")).toBe("paid");
    expect(normalizeGatewayPaymentStatus("PAID")).toBe("paid");
    expect(normalizeGatewayPaymentStatus("INITIATED")).toBe("pending");
    expect(normalizeGatewayPaymentStatus("AUTHORIZATION_FAILED")).toBe(
      "failed",
    );
    expect(normalizeGatewayPaymentStatus("CANCELLED")).toBe("cancelled");
    expect(normalizeGatewayPaymentStatus("mystery-state")).toBe("pending");
  });

  it("exposes only coarse payment method families", () => {
    expect(
      paymentMethodFamiliesFromGateway([
        { name: "EcoCash USD", code: "PZW" },
        { name: "Visa / Mastercard", code: "CARD" },
      ]),
    ).toEqual(["mobile_money", "bank_card"]);
  });

  it("formats the configurable semester hypothesis without floating-point UI noise", () => {
    expect(formatPlanPrice(300, "USD")).toBe("US$3");
    expect(formatPlanPrice(350, "USD")).toBe("US$3.50");
  });
});
