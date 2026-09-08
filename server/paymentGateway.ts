import type {
  PaymentMethodFamily,
  PaymentStatus,
} from "../src/domain/payments.js";

export type PaymentCheckoutInput = {
  merchantReference: string;
  amountMinor: number;
  currency: string;
  reason: string;
  resultUrl: string;
  returnUrl: string;
};

export type PaymentGatewayTransaction = {
  providerReference: string;
  redirectUrl: string;
  pollUrl: string | null;
  rawStatus: string;
  status: PaymentStatus;
};

export type PaymentGatewayStatus = {
  providerReference: string;
  rawStatus: string;
  status: PaymentStatus;
};

export interface PaymentGateway {
  readonly provider: "pesepay";
  createCheckout(
    input: PaymentCheckoutInput,
  ): Promise<PaymentGatewayTransaction>;
  getPaymentStatus(providerReference: string): Promise<PaymentGatewayStatus>;
  listSupportedMethods(currency: string): Promise<PaymentMethodFamily[]>;
}
