import { appConfig } from "./app";
import { BRAND } from "./brand";

export const legalConfig = {
  productName: appConfig.productName,
  tradingName: import.meta.env.VITE_LEGAL_TRADING_NAME ?? BRAND.productName,
  operatorName: import.meta.env.VITE_LEGAL_OPERATOR_NAME ?? BRAND.operatorName,
  operatorAddress:
    import.meta.env.VITE_LEGAL_OPERATOR_ADDRESS ?? "60B Mahombekombe Kariba",
  country: import.meta.env.VITE_LEGAL_COUNTRY ?? "Zimbabwe",
  supportEmail:
    import.meta.env.VITE_LEGAL_SUPPORT_EMAIL ?? appConfig.supportEmail,
  privacyEmail: import.meta.env.VITE_LEGAL_PRIVACY_EMAIL ?? BRAND.privacyEmail,
  effectiveDate: import.meta.env.VITE_LEGAL_EFFECTIVE_DATE ?? "2026-08-05",
  lastUpdatedDate: import.meta.env.VITE_LEGAL_LAST_UPDATED_DATE ?? "2026-08-05",
  publicAppUrl: appConfig.baseUrl,
  minimumAge: Number(import.meta.env.VITE_LEGAL_MINIMUM_AGE ?? 13),
  governingLaw: import.meta.env.VITE_LEGAL_GOVERNING_LAW ?? "Zimbabwe",
  disputeVenue:
    import.meta.env.VITE_LEGAL_DISPUTE_VENUE ??
    "Courts of competent jurisdiction in Zimbabwe",
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
