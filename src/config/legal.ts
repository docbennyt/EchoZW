import { appConfig } from "./app";

export const legalConfig = {
  productName: appConfig.productName,
  tradingName: import.meta.env.VITE_LEGAL_TRADING_NAME ?? "CalenderZW",
  operatorName: import.meta.env.VITE_LEGAL_OPERATOR_NAME ?? "aiDo",
  operatorAddress: import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS ?? "",
  country: import.meta.env.VITE_LEGAL_COUNTRY ?? "Zimbabwe",
  supportEmail:
    import.meta.env.VITE_LEGAL_SUPPORT_EMAIL ?? appConfig.supportEmail,
  privacyEmail:
    import.meta.env.VITE_LEGAL_PRIVACY_EMAIL ?? "privacy@aido.co.zw",
  effectiveDate: import.meta.env.VITE_LEGAL_EFFECTIVE_DATE ?? "2026-08-05",
  lastUpdatedDate: import.meta.env.VITE_LEGAL_LAST_UPDATED_DATE ?? "2026-08-05",
  publicAppUrl: appConfig.baseUrl,
  minimumAge: Number(import.meta.env.VITE_LEGAL_MINIMUM_AGE ?? 13),
  governingLaw: import.meta.env.VITE_LEGAL_GOVERNING_LAW ?? "",
  disputeVenue: import.meta.env.VITE_LEGAL_DISPUTE_VENUE ?? "",
  securityLogRetentionDays: Number(
    import.meta.env.VITE_SECURITY_LOG_RETENTION_DAYS ?? 90,
  ),
  deletedAccountGraceDays: Number(
    import.meta.env.VITE_DELETED_ACCOUNT_GRACE_DAYS ?? 30,
  ),
  failedOauthStateRetentionMinutes: Number(
    import.meta.env.VITE_FAILED_OAUTH_STATE_RETENTION_MINUTES ?? 30,
  ),
  paymentRecordRetentionDays: Number(
    import.meta.env.VITE_PAYMENT_RECORD_RETENTION_DAYS ?? 2555,
  ),
};
