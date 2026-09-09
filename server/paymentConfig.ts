import {
  DEFAULT_SEMESTER_PLAN,
  type PaymentMethodFamily,
  type PublicPaymentCapability,
} from "../src/domain/payments.js";

export type PaymentMode = "disabled" | "sandbox" | "production";

export type PaymentServerConfig = {
  mode: PaymentMode;
  enabled: boolean;
  productionVerified: boolean;
  integrationKey: string | null;
  encryptionKey: string | null;
  createPaymentUrl: string | null;
  statusUrl: string | null;
  methodsUrl: string | null;
  publicAppUrl: string;
  planCode: string;
  currency: string;
  amountMinor: number;
  pilotEndsOn: string;
};

const PRODUCTION_BASE = "https://api.pesepay.com/api/payments-engine";
const SANDBOX_BASE = "https://api.test.sandbox.pesepay.com/payments-engine";

function paymentMode(value: string | undefined): PaymentMode {
  if (value === "sandbox" || value === "production") return value;
  return "disabled";
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanOrigin(value: string | undefined) {
  return (value ?? "").trim().replace(/\/$/, "");
}

function validEncryptionKey(value: string | undefined) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") === 32;
}

export function resolvePaymentServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): PaymentServerConfig {
  const mode = paymentMode(env.PESEPAY_MODE);
  const integrationKey = env.PESEPAY_INTEGRATION_KEY?.trim() || null;
  const encryptionKey = validEncryptionKey(env.PESEPAY_ENCRYPTION_KEY)
    ? env.PESEPAY_ENCRYPTION_KEY!
    : null;
  const base =
    mode === "production"
      ? PRODUCTION_BASE
      : mode === "sandbox"
        ? SANDBOX_BASE
        : null;
  const configured = Boolean(integrationKey && encryptionKey && base);
  const productionVerified =
    mode === "production" && env.PESEPAY_LIVE_VERIFIED === "true";
  const enabledFlag = env.PAYMENTS_ENABLED === "true";

  return {
    mode,
    enabled:
      configured && enabledFlag && (mode === "sandbox" || productionVerified),
    productionVerified,
    integrationKey,
    encryptionKey,
    createPaymentUrl: base
      ? env.PESEPAY_CREATE_PAYMENT_URL?.trim() ||
        `${base}/${mode === "production" ? "v2" : "v1"}/payments/make-payment`
      : null,
    statusUrl: base
      ? env.PESEPAY_STATUS_URL?.trim() || `${base}/v1/payments/check-payment`
      : null,
    methodsUrl: base
      ? env.PESEPAY_METHODS_URL?.trim() ||
        `${base}/v1/payment-methods/for-currency`
      : null,
    publicAppUrl: cleanOrigin(env.PUBLIC_APP_URL ?? env.APP_ORIGIN),
    planCode:
      env.CALENDERZW_SEMESTER_PLAN_CODE?.trim() || DEFAULT_SEMESTER_PLAN.code,
    currency:
      env.CALENDERZW_SEMESTER_CURRENCY?.trim().toUpperCase() ||
      DEFAULT_SEMESTER_PLAN.currency,
    amountMinor: positiveInteger(
      env.CALENDERZW_SEMESTER_AMOUNT_MINOR,
      DEFAULT_SEMESTER_PLAN.amountMinor,
    ),
    pilotEndsOn: env.CALENDERZW_PILOT_ENDS_ON?.trim() || "2026-09-30",
  };
}

export function assertPaymentGatewayConfigured(config: PaymentServerConfig) {
  if (
    !config.integrationKey ||
    !config.encryptionKey ||
    !config.createPaymentUrl ||
    !config.statusUrl ||
    !config.methodsUrl
  ) {
    throw new Error("Pesepay payment gateway is not fully configured.");
  }
}

export function buildPublicPaymentCapability(
  config: PaymentServerConfig,
  methodFamilies: PaymentMethodFamily[] = [],
): PublicPaymentCapability {
  const gatewayReady = Boolean(
    config.mode !== "disabled" &&
    config.integrationKey &&
    config.encryptionKey &&
    config.createPaymentUrl &&
    config.statusUrl,
  );
  return {
    checkoutEnabled: config.enabled,
    gatewayReady,
    productionVerified: config.productionVerified,
    provider: gatewayReady ? "pesepay" : null,
    planCode: config.planCode,
    currency: config.currency,
    amountMinor: config.amountMinor,
    pilotEndsOn: config.pilotEndsOn,
    methodFamilies,
  };
}
