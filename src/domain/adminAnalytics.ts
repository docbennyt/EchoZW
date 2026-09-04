import { z } from "zod";

export const ANALYTICS_TIMEZONE = "Africa/Harare";
const maxRangeDays = 370;

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));

export const analyticsFilterSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    timezone: z.literal(ANALYTICS_TIMEZONE).default(ANALYTICS_TIMEZONE),
    institutionId: z.string().uuid().optional(),
    programmeId: z.string().uuid().optional(),
    classGroupId: z.string().uuid().optional(),
    timetableId: z.string().uuid().optional(),
    provider: z
      .enum([
        "google_api",
        "apple_subscription",
        "webcal_subscription",
        "ics_download",
        "outlook_subscription",
      ])
      .optional(),
    deviceKind: z.enum(["desktop", "mobile", "tablet", "other"]).optional(),
    browserFamily: z
      .enum(["chrome", "safari", "firefox", "edge", "other"])
      .optional(),
    osFamily: z
      .enum(["android", "ios", "windows", "macos", "linux", "other"])
      .optional(),
    utmSource: z.string().trim().max(80).optional(),
    stage: z.string().trim().max(80).optional(),
  })
  .superRefine((value, context) => {
    const from = Date.parse(`${value.from}T00:00:00Z`);
    const to = Date.parse(`${value.to}T00:00:00Z`);
    if (to < from) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: "End date must be on or after start date.",
      });
    }
    const days = Math.floor((to - from) / 86_400_000) + 1;
    if (days > maxRangeDays) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["to"],
        message: `Analytics date range cannot exceed ${maxRangeDays} days.`,
      });
    }
  });

export type AnalyticsFilters = z.infer<typeof analyticsFilterSchema>;

export function defaultAnalyticsFilters(now = new Date()) {
  const to = new Date(now);
  const from = new Date(now);
  from.setUTCDate(to.getUTCDate() - 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    timezone: ANALYTICS_TIMEZONE,
  } satisfies AnalyticsFilters;
}

export function parseAnalyticsFilters(params: URLSearchParams) {
  const defaults = defaultAnalyticsFilters();
  return analyticsFilterSchema.parse({
    from: params.get("from") ?? defaults.from,
    to: params.get("to") ?? defaults.to,
    timezone: params.get("timezone") ?? defaults.timezone,
    institutionId: params.get("institutionId") ?? undefined,
    programmeId: params.get("programmeId") ?? undefined,
    classGroupId: params.get("classGroupId") ?? undefined,
    timetableId: params.get("timetableId") ?? undefined,
    provider: params.get("provider") ?? undefined,
    deviceKind: params.get("deviceKind") ?? undefined,
    browserFamily: params.get("browserFamily") ?? undefined,
    osFamily: params.get("osFamily") ?? undefined,
    utmSource: params.get("utmSource") ?? undefined,
    stage: params.get("stage") ?? undefined,
  });
}

export type AnalyticsKpi = {
  id: string;
  label: string;
  value: number;
  comparisonValue: number | null;
  delta: number | null;
  definitionId: string;
};

export type AnalyticsOverview = {
  filters: AnalyticsFilters;
  refreshedAt: string;
  aggregateFreshnessMinutes: number | null;
  kpis: AnalyticsKpi[];
  providerMix: {
    provider: string;
    setupChoices: number;
    activeConnections: number;
  }[];
  adoptionTimeseries: {
    date: string;
    uniquePeople: number;
    timetableViews: number;
    onboardingStarts: number;
    calendarConnections: number;
    googleConnections: number;
    shares: number;
  }[];
  funnel: {
    stage: string;
    people: number;
    conversionFromPrevious: number | null;
    conversionFromFirst: number | null;
    dropoffCount: number | null;
    dropoffRate: number | null;
  }[];
  dataQuality: {
    eventsReceived: number;
    uniqueAnonymousIdentities: number;
    identitiesStitchedToSubscriptions: number;
    consentedContactLinkageRate: number;
    missingTimetableContext: number;
    missingSubscriptionLinkage: number;
    identityStitchingRate: number;
    knownVsAnonymousRatio: number;
    lastIngestionAt: string | null;
    persistenceFailures: number | null;
    unexpectedEventNames: string[];
    knownHistoricalInstrumentationGaps: string[];
  };
  operations: FounderOperationsOverview;
};

export type FounderOperationsOverview = {
  pilotPulse: {
    uniqueTimetableViewers: number;
    onboardingStarts: number;
    onboardingCompletions: number;
    calendarSubscriptionsCreated: number;
    updateEnabledSubscriptions: number;
    oneTimeIcsDownloads: number;
    feedObservedSubscriptions: number;
    shares: number;
    activationConversion: number | null;
  };
  subscriberHealth: {
    timetableId: string;
    publicSlug: string;
    label: string;
    activeSubscriptions: number;
    updateEnabledSubscriptions: number;
    oneTimeIcsDownloads: number;
    contactableSubscriptions: number;
    feedObservedSubscriptions: number;
    lastFeedObservedAt: string | null;
    providerMix: Record<string, number>;
  }[];
  timetableTrust: {
    timetableId: string;
    publicSlug: string;
    label: string;
    currentPublishedAt: string | null;
    latestSourceSnapshotAt: string | null;
    unresolvedSourceReviews: number;
    pinnedCorrections: number;
    pendingExceptions: number;
    hasClassRep: boolean;
    warnings: string[];
  }[];
  classRepOperations: {
    activeClassReps: number;
    assignedTimetables: number;
    unassignedPublishedTimetables: number;
    recentCorrections: number;
  };
};

export const emptyFounderOperationsOverview: FounderOperationsOverview = {
  pilotPulse: {
    uniqueTimetableViewers: 0,
    onboardingStarts: 0,
    onboardingCompletions: 0,
    calendarSubscriptionsCreated: 0,
    updateEnabledSubscriptions: 0,
    oneTimeIcsDownloads: 0,
    feedObservedSubscriptions: 0,
    shares: 0,
    activationConversion: null,
  },
  subscriberHealth: [],
  timetableTrust: [],
  classRepOperations: {
    activeClassReps: 0,
    assignedTimetables: 0,
    unassignedPublishedTimetables: 0,
    recentCorrections: 0,
  },
};
