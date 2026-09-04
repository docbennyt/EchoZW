export const ANALYTICS_EVENT_NAMES = [
  "landing_viewed",
  "pilot_offer_viewed",
  "pilot_cta_clicked",
  "future_price_viewed",
  "finder_opened",
  "finder_search_started",
  "institution_selected",
  "programme_selected",
  "class_group_selected",
  "timetable_search_completed",
  "timetable_search_no_results",
  "timetable_result_opened",
  "timetable_viewed",
  "calendar_cta_clicked",
  "onboarding_opened",
  "onboarding_step_viewed",
  "onboarding_step_completed",
  "provider_selected",
  "phone_step_completed",
  "reminder_selected",
  "calendar_method_selected",
  "ics_downloaded",
  "subscription_created",
  "subscription_url_copied",
  "apple_calendar_opened",
  "onboarding_completed",
  "onboarding_abandoned",
  "share_prompt_viewed",
  "calendar_drawer_opened",
  "reminder_preset_selected",
  "calendar_provider_selected",
  "calendar_subscription_created",
  "apple_webcal_opened",
  "ics_download_started",
  "ics_download_completed",
  "google_oauth_started",
  "google_oauth_completed",
  "google_oauth_failed",
  "google_calendar_created",
  "google_calendar_sync_completed",
  "google_calendar_sync_failed",
  "calendar_success_viewed",
  "calendar_setup_help_opened",
  "subscription_link_copied",
  "timetable_shared",
  "share_link_opened",
  "admin_logged_in",
  "auth_client_error",
  "admin_timetable_created",
  "admin_timetable_published",
  "admin_timetable_updated",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];
export type AnalyticsPrimitive = string | number | boolean | null;
export type AnalyticsProperties = Record<string, AnalyticsPrimitive>;

export const ANALYTICS_PROPERTY_KEYS = [
  "publicSlug",
  "provider",
  "preset",
  "reminderPreset",
  "method",
  "source",
  "status",
  "result",
  "reason",
  "path",
  "mode",
  "timetableId",
  "subscriptionId",
  "versionNumber",
  "sessionCount",
  "customMinutes",
  "offsetMinutes",
  "shareTarget",
  "step",
  "country",
  "entryPath",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "shareAttributionId",
  "institutionId",
  "programmeId",
  "classGroupId",
  "failureClass",
] as const;

const eventNameSet = new Set<string>(ANALYTICS_EVENT_NAMES);
const propertyKeySet = new Set<string>(ANALYTICS_PROPERTY_KEYS);
const sensitiveKeyPattern =
  /(^code$|token|secret|credential|authorization|password|phone|email|push|endpoint|vapid|recovery)/i;

export function isAnalyticsEventName(
  value: unknown,
): value is AnalyticsEventName {
  return typeof value === "string" && eventNameSet.has(value);
}

export function isAnalyticsUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export function sanitizeAnalyticsProperties(
  input: unknown,
): AnalyticsProperties {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const output: AnalyticsProperties = {};
  for (const [key, value] of Object.entries(input)) {
    if (!propertyKeySet.has(key) || sensitiveKeyPattern.test(key)) continue;
    if (value === null || typeof value === "boolean") {
      output[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      output[key] = value;
      continue;
    }
    if (typeof value === "string") {
      output[key] = value.trim().slice(0, 160);
    }
  }
  return output;
}

export const ADOPTION_STAGES = [
  "Visitor",
  "Timetable viewer",
  "Engaged",
  "Onboarding started",
  "Provider selected",
  "Calendar connected",
  "Active subscriber",
  "Advocate",
  "At risk",
] as const;

export type AdoptionStage = (typeof ADOPTION_STAGES)[number];

export const IDENTITY_STRENGTHS = [
  "anonymous",
  "subscription_linked",
  "consented_contact_linked",
] as const;

export type IdentityStrength = (typeof IDENTITY_STRENGTHS)[number];

export type AnalyticsPersonEvidence = {
  eventNames: AnalyticsEventName[];
  sessionIds?: string[];
  hasActiveCalendarConnection?: boolean;
  hasRecentFeedOrSyncActivity?: boolean;
  hasProlongedProviderFailure?: boolean;
  hasConsentedContact?: boolean;
  subscriptionIds?: string[];
};

const engagedEvents = new Set<AnalyticsEventName>([
  "calendar_cta_clicked",
  "share_prompt_viewed",
  "timetable_shared",
  "share_link_opened",
]);

const providerSelectedEvents = new Set<AnalyticsEventName>([
  "provider_selected",
  "calendar_method_selected",
  "calendar_provider_selected",
]);

const connectedEvents = new Set<AnalyticsEventName>([
  "subscription_created",
  "calendar_subscription_created",
  "google_oauth_completed",
  "google_calendar_created",
]);

export function determineIdentityStrength(
  evidence: Pick<
    AnalyticsPersonEvidence,
    "hasConsentedContact" | "subscriptionIds"
  >,
): IdentityStrength {
  if (evidence.hasConsentedContact) return "consented_contact_linked";
  if ((evidence.subscriptionIds ?? []).length > 0) return "subscription_linked";
  return "anonymous";
}

export function analyticsIdentityLabel(strength: IdentityStrength) {
  if (strength === "consented_contact_linked") return "Consented contact";
  if (strength === "subscription_linked") return "Subscription-linked student";
  return "Anonymous visitor";
}

export type AnalyticsIdentityJoinEvidence = {
  leftAnonymousId?: string | null;
  rightAnonymousId?: string | null;
  leftSubscriptionId?: string | null;
  rightSubscriptionId?: string | null;
  leftSubscriberProfileId?: string | null;
  rightSubscriberProfileId?: string | null;
};

export function shouldJoinAnalyticsIdentities(
  evidence: AnalyticsIdentityJoinEvidence,
) {
  if (
    evidence.leftSubscriptionId &&
    evidence.leftSubscriptionId === evidence.rightSubscriptionId
  ) {
    return true;
  }
  if (
    evidence.leftSubscriberProfileId &&
    evidence.leftSubscriberProfileId === evidence.rightSubscriberProfileId
  ) {
    return true;
  }
  return Boolean(
    evidence.leftAnonymousId &&
    evidence.leftAnonymousId === evidence.rightAnonymousId,
  );
}

export function determineAdoptionStage(
  evidence: AnalyticsPersonEvidence,
): AdoptionStage {
  const events = new Set(evidence.eventNames);
  if (evidence.hasProlongedProviderFailure) return "At risk";
  if (events.has("timetable_shared")) return "Advocate";
  if (
    evidence.hasActiveCalendarConnection &&
    evidence.hasRecentFeedOrSyncActivity
  ) {
    return "Active subscriber";
  }
  if (
    evidence.hasActiveCalendarConnection ||
    [...connectedEvents].some((event) => events.has(event))
  ) {
    return "Calendar connected";
  }
  if ([...providerSelectedEvents].some((event) => events.has(event))) {
    return "Provider selected";
  }
  if (events.has("onboarding_opened")) return "Onboarding started";
  if (
    [...engagedEvents].some((event) => events.has(event)) ||
    new Set(evidence.sessionIds ?? []).size > 1
  ) {
    return "Engaged";
  }
  if (events.has("timetable_viewed")) return "Timetable viewer";
  return "Visitor";
}

export type EngagementScoreExplanation = {
  score: number;
  contributions: { label: string; points: number }[];
};

const scoreRules: {
  eventName: AnalyticsEventName;
  label: string;
  points: number;
  once?: boolean;
}[] = [
  { eventName: "timetable_viewed", label: "Timetable viewed", points: 5 },
  {
    eventName: "calendar_cta_clicked",
    label: "Calendar CTA clicked",
    points: 10,
  },
  { eventName: "onboarding_opened", label: "Onboarding started", points: 10 },
  { eventName: "provider_selected", label: "Provider selected", points: 10 },
  {
    eventName: "calendar_provider_selected",
    label: "Provider selected",
    points: 10,
  },
  {
    eventName: "calendar_subscription_created",
    label: "Subscription created",
    points: 25,
  },
  {
    eventName: "subscription_created",
    label: "Subscription created",
    points: 25,
  },
  {
    eventName: "google_oauth_completed",
    label: "Google OAuth completed",
    points: 15,
  },
  {
    eventName: "google_calendar_sync_completed",
    label: "Successful calendar sync",
    points: 10,
  },
  { eventName: "timetable_shared", label: "Shared timetable", points: 15 },
  {
    eventName: "onboarding_abandoned",
    label: "Abandoned onboarding",
    points: -5,
  },
  {
    eventName: "google_calendar_sync_failed",
    label: "Repeated provider error",
    points: -10,
  },
];

export function explainEngagementScore(
  eventNames: AnalyticsEventName[],
  sessionIds: string[] = [],
): EngagementScoreExplanation {
  const counts = new Map<AnalyticsEventName, number>();
  for (const eventName of eventNames) {
    counts.set(eventName, (counts.get(eventName) ?? 0) + 1);
  }

  const contributions = scoreRules
    .map((rule) => {
      const count = counts.get(rule.eventName) ?? 0;
      if (count === 0) return null;
      return {
        label: rule.label,
        points: rule.points * (rule.once ? 1 : count),
      };
    })
    .filter(
      (value): value is { label: string; points: number } => value !== null,
    );

  if (new Set(sessionIds).size > 1) {
    contributions.push({ label: "Second session", points: 5 });
  }

  const rawScore = contributions.reduce((sum, item) => sum + item.points, 0);
  return {
    score: Math.max(0, Math.min(100, rawScore)),
    contributions,
  };
}

export function sanitizeReferrerHost(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value);
    return parsed.hostname.toLowerCase().slice(0, 160);
  } catch {
    return value
      .trim()
      .replace(/[/?#].*$/, "")
      .toLowerCase()
      .slice(0, 160);
  }
}

export function maskPhoneE164(value: string | null | undefined) {
  if (!value) return null;
  const normalized = value.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) return null;
  const visiblePrefix = normalized.slice(0, Math.min(7, normalized.length - 4));
  return `${visiblePrefix}...${normalized.slice(-4)}`;
}

export function redactAnalyticsValue(key: string, value: unknown) {
  if (sensitiveKeyPattern.test(key)) return undefined;
  if (/phone/i.test(key) && typeof value === "string")
    return maskPhoneE164(value);
  return value;
}

export type CoarseClient = {
  deviceKind: "desktop" | "mobile" | "tablet" | "other";
  browserFamily: "chrome" | "safari" | "firefox" | "edge" | "other";
  osFamily: "android" | "ios" | "windows" | "macos" | "linux" | "other";
};

export function classifyAnalyticsClient(
  userAgent: string | undefined,
): CoarseClient {
  const ua = userAgent ?? "";
  const isTablet = /iPad|Tablet|Nexus 7|Nexus 9|SM-T|Tab/i.test(ua);
  const isMobile = /Mobile|Android|iPhone|iPod/i.test(ua) && !isTablet;
  const deviceKind: CoarseClient["deviceKind"] = isTablet
    ? "tablet"
    : isMobile
      ? "mobile"
      : ua
        ? "desktop"
        : "other";

  const browserFamily: CoarseClient["browserFamily"] = /Edg\//i.test(ua)
    ? "edge"
    : /Firefox\//i.test(ua)
      ? "firefox"
      : /Chrome\//i.test(ua) || /CriOS\//i.test(ua)
        ? "chrome"
        : /Safari\//i.test(ua)
          ? "safari"
          : "other";

  const osFamily: CoarseClient["osFamily"] = /Android/i.test(ua)
    ? "android"
    : /iPhone|iPad|iPod/i.test(ua)
      ? "ios"
      : /Windows/i.test(ua)
        ? "windows"
        : /Mac OS X|Macintosh/i.test(ua)
          ? "macos"
          : /Linux/i.test(ua)
            ? "linux"
            : "other";

  return { deviceKind, browserFamily, osFamily };
}
