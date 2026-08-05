export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled";

export type CreatePaymentInput = {
  planId: "semester_plus";
  amount: number;
  currency: "USD";
  customerReference: string;
  returnUrl: string;
};

export type PaymentResult = {
  provider: "pesepay_mock";
  providerReference: string;
  status: PaymentStatus;
  checkoutUrl?: string;
};

export interface PaymentProvider {
  createCheckout(input: CreatePaymentInput): Promise<PaymentResult>;
  verifyPayment(providerReference: string): Promise<PaymentResult>;
}

export class MockPesePayProvider implements PaymentProvider {
  async createCheckout(input: CreatePaymentInput): Promise<PaymentResult> {
    return {
      provider: "pesepay_mock",
      providerReference: `mock_${input.customerReference}_${Date.now()}`,
      status: "pending",
      checkoutUrl: `${input.returnUrl}?mock_payment=pending`,
    };
  }

  async verifyPayment(providerReference: string): Promise<PaymentResult> {
    return {
      provider: "pesepay_mock",
      providerReference,
      status: "pending",
    };
  }
}
