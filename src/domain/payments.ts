export const DEFAULT_SEMESTER_PLAN = {
  code: "semester_pass",
  displayName: "CalenderZW Semester Pass",
  currency: "USD",
  amountMinor: 300,
} as const;

export const PAYMENT_STATUSES = [
  "pending",
  "paid",
  "failed",
  "cancelled",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export type PaymentMethodFamily = "mobile_money" | "bank_card";

export type PublicPaymentCapability = {
  checkoutEnabled: boolean;
  gatewayReady: boolean;
  productionVerified: boolean;
  provider: "pesepay" | null;
  planCode: string;
  currency: string;
  amountMinor: number;
  pilotEndsOn: string;
  methodFamilies: PaymentMethodFamily[];
};

const paidStatuses = new Set([
  "PAID",
  "SUCCESS",
  "SUCCESSFUL",
  "COMPLETED",
  "COMPLETE",
]);
const failedStatuses = new Set([
  "FAILED",
  "AUTHORIZATION_FAILED",
  "DECLINED",
  "REVERSED",
  "ERROR",
]);
const cancelledStatuses = new Set(["CANCELLED", "CANCELED", "ABORTED"]);

export function normalizeGatewayPaymentStatus(value: unknown): PaymentStatus {
  if (typeof value !== "string") return "pending";
  const normalized = value.trim().toUpperCase();
  if (paidStatuses.has(normalized)) return "paid";
  if (cancelledStatuses.has(normalized)) return "cancelled";
  if (failedStatuses.has(normalized)) return "failed";
  return "pending";
}

export function paymentMethodFamiliesFromGateway(
  methods: Array<{ name?: unknown; code?: unknown }> | null | undefined,
): PaymentMethodFamily[] {
  const families = new Set<PaymentMethodFamily>();
  for (const method of methods ?? []) {
    const text =
      `${String(method.name ?? "")} ${String(method.code ?? "")}`.toLowerCase();
    if (/ecocash|one ?money|telecash|innbucks|mobile|wallet/.test(text)) {
      families.add("mobile_money");
    }
    if (/visa|mastercard|master card|zimswitch|card|bank/.test(text)) {
      families.add("bank_card");
    }
  }
  return [...families];
}

export function formatPlanPrice(amountMinor: number, currency: string) {
  const amount = amountMinor / 100;
  const prefix =
    currency.toUpperCase() === "USD" ? "US$" : `${currency.toUpperCase()} `;
  return `${prefix}${Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(2)}`;
}

export function isSafeCurrencyCode(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Z]{3}$/.test(value.trim().toUpperCase())
  );
}

export function sanitizePaymentFailureClass(value: unknown) {
  if (typeof value !== "string") return "unknown";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_");
  return normalized.slice(0, 64) || "unknown";
}
