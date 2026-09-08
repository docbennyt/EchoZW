import type { PublicPaymentCapability } from "../domain/payments";

export async function fetchPaymentCapabilities(): Promise<PublicPaymentCapability> {
  const response = await fetch("/api/payments/capabilities", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("Payment capability is unavailable.");
  }
  return (await response.json()) as PublicPaymentCapability;
}

export async function createPaymentCheckout(input: {
  subscriptionId: string;
  idempotencyKey: string;
}) {
  const response = await fetch("/api/payments/checkout", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      String(
        (body.error as { message?: string } | undefined)?.message ??
          "Payment checkout could not start.",
      ),
    );
  }
  return body;
}

export async function fetchPaymentStatus(purchaseId: string) {
  const response = await fetch(
    `/api/payments/status?purchaseId=${encodeURIComponent(purchaseId)}`,
    { headers: { Accept: "application/json" } },
  );
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) throw new Error("Payment status is unavailable.");
  return body;
}
