import { describe, expect, it, vi } from "vitest";
import { resolvePaymentServerConfig } from "../server/paymentConfig";
import {
  decryptPesepayPayload,
  encryptPesepayPayload,
  PesepayGateway,
} from "../server/pesepayGateway";

const encryptionKey = "12345678901234567890123456789012";
const config = resolvePaymentServerConfig({
  PESEPAY_MODE: "sandbox",
  PAYMENTS_ENABLED: "true",
  PESEPAY_INTEGRATION_KEY: "integration-key",
  PESEPAY_ENCRYPTION_KEY: encryptionKey,
  PUBLIC_APP_URL: "https://calender.example",
} as NodeJS.ProcessEnv);

describe("Pesepay gateway", () => {
  it("encrypts redirect checkout details and decrypts the provider response", async () => {
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, init?: RequestInit) => {
        const requestBody = JSON.parse(String(init?.body)) as {
          payload: string;
        };
        const decrypted = decryptPesepayPayload<Record<string, unknown>>(
          requestBody.payload,
          encryptionKey,
        );
        expect(decrypted.merchantReference).toBe("CZW-TEST");
        expect(decrypted.amountDetails).toEqual({
          amount: 3,
          currencyCode: "USD",
        });
        expect(JSON.stringify(init?.body)).not.toContain("CZW-TEST");
        return new Response(
          JSON.stringify({
            payload: encryptPesepayPayload(
              {
                referenceNumber: "P-REF-1",
                redirectUrl: "https://payments.pesepay.com/pay/abc",
                pollUrl:
                  "https://api.test.sandbox.pesepay.com/payments-engine/v1/payments/check-payment",
                transactionStatus: "INITIATED",
              },
              encryptionKey,
            ),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    );
    const gateway = new PesepayGateway(config, fetchImpl as typeof fetch);
    const result = await gateway.createCheckout({
      merchantReference: "CZW-TEST",
      amountMinor: 300,
      currency: "USD",
      reason: "Semester pass",
      resultUrl: "https://calender.example/api/payments/result",
      returnUrl: "https://calender.example/find",
    });
    expect(result.providerReference).toBe("P-REF-1");
    expect(result.status).toBe("pending");
    expect(result.redirectUrl).toContain("payments.pesepay.com");
  });

  it("re-checks status server-side and recognizes a verified paid state", async () => {
    const fetchImpl = vi.fn(
      async (_url: URL | RequestInfo, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            payload: encryptPesepayPayload(
              { referenceNumber: "P-REF-1", transactionStatus: "SUCCESS" },
              encryptionKey,
            ),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const result = await new PesepayGateway(
      config,
      fetchImpl as typeof fetch,
    ).getPaymentStatus("P-REF-1");
    expect(result.status).toBe("paid");
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain(
      "referenceNumber=P-REF-1",
    );
  });

  it("maps live method names to coarse families rather than exposing financial details", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { name: "EcoCash", code: "ECO" },
            { name: "Visa Card", code: "CARD" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const methods = await new PesepayGateway(
      config,
      fetchImpl as typeof fetch,
    ).listSupportedMethods("USD");
    expect(methods).toEqual(["mobile_money", "bank_card"]);
  });
});
