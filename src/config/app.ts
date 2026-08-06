import { getPublicAppUrl } from "../domain/publicUrl";
import { BRAND } from "./brand";

const browserOrigin =
  typeof window !== "undefined" && import.meta.env.PROD
    ? window.location.origin
    : undefined;

const publicOrigin = getPublicAppUrl(
  {
    VITE_PUBLIC_APP_URL: import.meta.env.VITE_PUBLIC_APP_URL ?? browserOrigin,
    VITE_APP_BASE_URL: import.meta.env.VITE_APP_BASE_URL,
  },
  import.meta.env.PROD ? "production" : "development",
);

export const appConfig = {
  productName: BRAND.productName,
  companyName: BRAND.operatorName,
  familyName: BRAND.productName,
  attribution: BRAND.attribution,
  descriptor: BRAND.descriptor,
  domain: BRAND.domain,
  origin: BRAND.origin,
  companyUrl: BRAND.companyUrl,
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL ?? BRAND.supportEmail,
  defaultCountry: "Zimbabwe",
  defaultTimezone: "Africa/Harare",
  defaultCurrency: "USD",
  baseUrl: publicOrigin,
  premiumPlanPrice: 2,
  enabledCalendarProviders: ["apple", "google", "outlook", "ics"] as const,
  legalUrls: {
    privacy: "/privacy",
    terms: "/terms",
    deletion: "/data-deletion",
    support: "/support",
  },
};

export const featureFlags = {
  googleCalendarSync:
    import.meta.env.VITE_ENABLE_GOOGLE_CALENDAR_SYNC === "true",
  pesepayCheckout: import.meta.env.VITE_ENABLE_PESEPAY_CHECKOUT === "true",
  premiumFeatures: import.meta.env.VITE_ENABLE_PREMIUM_FEATURES === "true",
  privateTimetables: import.meta.env.VITE_ENABLE_PRIVATE_TIMETABLES !== "false",
  documentUploads: import.meta.env.VITE_ENABLE_DOCUMENT_UPLOADS === "true",
  aiExtraction: import.meta.env.VITE_ENABLE_AI_EXTRACTION === "true",
  institutionBranding:
    import.meta.env.VITE_ENABLE_INSTITUTION_BRANDING !== "false",
  webPush: import.meta.env.VITE_ENABLE_WEB_PUSH === "true",
  whatsappNotifications:
    import.meta.env.VITE_ENABLE_WHATSAPP_NOTIFICATIONS === "true",
};
