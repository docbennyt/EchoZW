import { createCipheriv, createDecipheriv } from "node:crypto";
import {
  normalizeGatewayPaymentStatus,
  paymentMethodFamiliesFromGateway,
} from "../src/domain/payments.js";
import {
  assertPaymentGatewayConfigured,
  type PaymentServerConfig,
} from "./paymentConfig.js";
import type {
  PaymentCheckoutInput,
  PaymentGateway,
  PaymentGatewayStatus,
  PaymentGatewayTransaction,
} from "./paymentGateway.js";

type FetchLike = typeof fetch;

type PesepayTransaction = {
  referenceNumber?: unknown;
  redirectUrl?: unknown;
  pollUrl?: unknown;
  transactionStatus?: unknown;
};

function keyBytes(encryptionKey: string) {
  const key = Buffer.from(encryptionKey, "utf8");
  if (key.length !== 32) {
    throw new Error("Pesepay encryption key must be exactly 32 UTF-8 bytes.");
  }
  return key;
}

export function encryptPesepayPayload(
  value: unknown,
  encryptionKey: string,
): string {
  const key = keyBytes(encryptionKey);
  const iv = Buffer.from(encryptionKey.slice(0, 16), "utf8");
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  return Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]).toString("base64");
}

export function decryptPesepayPayload<T = unknown>(
  payload: string,
  encryptionKey: string,
): T {
  const key = keyBytes(encryptionKey);
  const iv = Buffer.from(encryptionKey.slice(0, 16), "utf8");
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(decrypted) as T;
}

function requireHttpsUrl(value: unknown, field: string) {
  if (typeof value !== "string")
    throw new Error(`Pesepay ${field} is missing.`);
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Pesepay ${field} must use HTTPS.`);
  }
  return url.toString();
}

function requireReference(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Pesepay reference number is missing.");
  }
  return value.trim();
}

async function readJson(response: Response) {
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`Pesepay request failed with HTTP ${response.status}.`);
  }
  return body;
}

export class PesepayGateway implements PaymentGateway {
  readonly provider = "pesepay" as const;

  constructor(
    private readonly config: PaymentServerConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    assertPaymentGatewayConfigured(config);
  }

  private credentials() {
    const integrationKey = this.config.integrationKey!;
    const encryptionKey = this.config.encryptionKey!;
    return { integrationKey, encryptionKey };
  }

  async createCheckout(
    input: PaymentCheckoutInput,
  ): Promise<PaymentGatewayTransaction> {
    const { integrationKey, encryptionKey } = this.credentials();
    const request = {
      amountDetails: {
        amount: input.amountMinor / 100,
        currencyCode: input.currency,
      },
      merchantReference: input.merchantReference,
      reasonForPayment: input.reason,
      resultUrl: input.resultUrl,
      returnUrl: input.returnUrl,
    };
    const response = await this.fetchImpl(this.config.createPaymentUrl!, {
      method: "POST",
      headers: {
        authorization: integrationKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        payload: encryptPesepayPayload(request, encryptionKey),
      }),
    });
    const encrypted = (await readJson(response)) as { payload?: unknown };
    if (typeof encrypted.payload !== "string") {
      throw new Error("Pesepay returned an invalid encrypted response.");
    }
    const transaction = decryptPesepayPayload<PesepayTransaction>(
      encrypted.payload,
      encryptionKey,
    );
    const rawStatus = String(transaction.transactionStatus ?? "INITIATED");
    return {
      providerReference: requireReference(transaction.referenceNumber),
      redirectUrl: requireHttpsUrl(transaction.redirectUrl, "redirect URL"),
      pollUrl:
        typeof transaction.pollUrl === "string"
          ? requireHttpsUrl(transaction.pollUrl, "poll URL")
          : null,
      rawStatus,
      status: normalizeGatewayPaymentStatus(rawStatus),
    };
  }

  async getPaymentStatus(
    providerReference: string,
  ): Promise<PaymentGatewayStatus> {
    const { integrationKey, encryptionKey } = this.credentials();
    const url = new URL(this.config.statusUrl!);
    url.searchParams.set("referenceNumber", providerReference);
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: integrationKey,
        "content-type": "application/json",
      },
    });
    const encrypted = (await readJson(response)) as { payload?: unknown };
    if (typeof encrypted.payload !== "string") {
      throw new Error("Pesepay returned an invalid encrypted status response.");
    }
    const transaction = decryptPesepayPayload<PesepayTransaction>(
      encrypted.payload,
      encryptionKey,
    );
    const rawStatus = String(transaction.transactionStatus ?? "PENDING");
    return {
      providerReference:
        typeof transaction.referenceNumber === "string"
          ? transaction.referenceNumber
          : providerReference,
      rawStatus,
      status: normalizeGatewayPaymentStatus(rawStatus),
    };
  }

  async listSupportedMethods(currency: string) {
    const { integrationKey } = this.credentials();
    const url = new URL(this.config.methodsUrl!);
    url.searchParams.set("currencyCode", currency);
    const response = await this.fetchImpl(url, {
      headers: {
        authorization: integrationKey,
        "content-type": "application/json",
      },
    });
    const body = await readJson(response);
    if (!Array.isArray(body)) return [];
    return paymentMethodFamiliesFromGateway(
      body.map((method) => {
        const value = method as Record<string, unknown>;
        return {
          name:
            value.name ?? value.paymentMethodName ?? value.description ?? null,
          code: value.code ?? value.paymentMethodCode ?? null,
        };
      }),
    );
  }
}
