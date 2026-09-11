import { ANALYTICS_METRIC_REGISTRY } from "../src/domain/analyticsMetrics.js";
import type {
  AnalyticsFilters,
  AnalyticsFunnelStage,
  AnalyticsOverview,
  FounderOperationsOverview,
} from "../src/domain/adminAnalytics.js";
import { emptyFounderOperationsOverview } from "../src/domain/adminAnalytics.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: { message?: string } | null };

const reminderEvents = ["reminder_selected", "reminder_preset_selected"];
const providerSelectionEvents = [
  "provider_selected",
  "calendar_method_selected",
  "calendar_provider_selected",
];
const providerHandoffEvents = [
  "subscription_created",
  "calendar_subscription_created",
  "google_oauth_started",
  "apple_calendar_opened",
  "apple_webcal_opened",
  "subscription_url_copied",
  "subscription_link_copied",
  "ics_download_started",
];
const googleVerifiedEvents = [
  "google_calendar_created",
  "google_calendar_sync_completed",
];
const googleFailureEvents = [
  "google_oauth_failed",
  "google_calendar_sync_failed",
];

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function asSingle<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function tableLabel(row: JsonRecord) {
  const timetable = asSingle(
    row.timetables as JsonRecord | JsonRecord[] | null,
  );
  const institution = asSingle(
    timetable?.institutions as JsonRecord | JsonRecord[] | null,
  );
  const programme = asSingle(
    timetable?.programmes as JsonRecord | JsonRecord[] | null,
  );
  const cohort = asSingle(
    timetable?.cohorts as JsonRecord | JsonRecord[] | null,
  );
  return [
    institution?.short_name ?? institution?.name,
    programme?.name,
    cohort?.label,
  ]
    .filter(Boolean)
    .map(String)
    .join(" - ");
}

function groupByTimetable(rows: JsonRecord[]) {
  const grouped = new Map<string, JsonRecord[]>();
  for (const row of rows) {
    const timetableId = stringValue(row.timetable_id);
    if (!timetableId) continue;
    grouped.set(timetableId, [...(grouped.get(timetableId) ?? []), row]);
  }
  return grouped;
}

async function expectData<T>(
  query: PromiseLike<QueryResult<T>>,
  message: string,
) {
  const { data, error } = await query;
  if (error) throw new Error(`${message}: ${error.message ?? "unknown error"}`);
  return data;
}

function eventCountByName(events: JsonRecord[], names: string[]) {
  return events.filter((event) => names.includes(stringValue(event.event_name)))
    .length;
}

function eventProperties(event: JsonRecord) {
  const properties = event.properties;
  return properties &&
    typeof properties === "object" &&
    !Array.isArray(properties)
    ? (properties as JsonRecord)
    : {};
}

function eventPersonKey(event: JsonRecord) {
  const personId = stringValue(event.analytics_person_id);
  if (personId) return `person:${personId}`;
  const anonymousId = stringValue(event.anonymous_id);
  return anonymousId ? `anonymous:${anonymousId}` : null;
}

function uniquePersonKeys(events: JsonRecord[], names?: string[]) {
  const keys = new Set<string>();
  for (const event of events) {
    if (names && !names.includes(stringValue(event.event_name))) continue;
    const key = eventPersonKey(event);
    if (key) keys.add(key);
  }
  return keys;
}

function intersection(left: Set<string>, right: Set<string>) {
  return new Set([...left].filter((value) => right.has(value)));
}

function inWindow(value: unknown, fromIso: string, toIso: string) {
  const timestamp = nullableString(value);
  return Boolean(timestamp && timestamp >= fromIso && timestamp < toIso);
}

function subscriptionProviderMap(subscriptions: JsonRecord[]) {
  return new Map(
    subscriptions
      .map(
        (subscription) =>
          [
            stringValue(subscription.id),
            stringValue(subscription.provider),
          ] as const,
      )
      .filter(([id]) => Boolean(id)),
  );
}

function eventMatchesCohortFilters(
  event: JsonRecord,
  filters: AnalyticsFilters,
) {
  if (
    filters.deviceKind &&
    stringValue(event.device_kind) !== filters.deviceKind
  ) {
    return false;
  }
  if (
    filters.browserFamily &&
    stringValue(event.browser_family) !== filters.browserFamily
  ) {
    return false;
  }
  if (filters.osFamily && stringValue(event.os_family) !== filters.osFamily) {
    return false;
  }
  if (filters.entryPath) {
    const entryPath = stringValue(eventProperties(event).entryPath);
    if (entryPath !== filters.entryPath) return false;
  }
  return true;
}

function conversionEventsForFilters(
  events: JsonRecord[],
  subscriptions: JsonRecord[],
  filters: AnalyticsFilters,
) {
  const base = events.filter((event) =>
    eventMatchesCohortFilters(event, filters),
  );
  if (!filters.provider) return base;

  const providersBySubscription = subscriptionProviderMap(subscriptions);
  const providerPeople = new Set<string>();
  for (const event of base) {
    const provider =
      stringValue(event.provider) ||
      providersBySubscription.get(stringValue(event.subscription_id)) ||
      "";
    if (provider !== filters.provider) continue;
    const key = eventPersonKey(event);
    if (key) providerPeople.add(key);
  }

  return base.filter((event) => {
    const key = eventPersonKey(event);
    return Boolean(key && providerPeople.has(key));
  });
}

function subscriptionPersonKeys(events: JsonRecord[]) {
  const keysBySubscription = new Map<string, Set<string>>();
  for (const event of events) {
    const subscriptionId = stringValue(event.subscription_id);
    const personKey = eventPersonKey(event);
    if (!subscriptionId || !personKey) continue;
    const keys = keysBySubscription.get(subscriptionId) ?? new Set<string>();
    keys.add(personKey);
    keysBySubscription.set(subscriptionId, keys);
  }
  return keysBySubscription;
}

function verifiedActivationPeople(
  events: JsonRecord[],
  subscriptions: JsonRecord[],
  filters: AnalyticsFilters,
  fromIso: string,
  toIso: string,
) {
  const verified = uniquePersonKeys(events, googleVerifiedEvents);
  const keysBySubscription = subscriptionPersonKeys(events);

  for (const subscription of subscriptions) {
    if (stringValue(subscription.status) !== "active") continue;
    const provider = stringValue(subscription.provider);
    if (provider === "ics_download") continue;
    if (filters.provider && provider !== filters.provider) continue;

    const feedObserved =
      provider !== "google_api" &&
      inWindow(subscription.last_feed_fetch_at, fromIso, toIso);
    const googleSynced =
      provider === "google_api" &&
      inWindow(subscription.last_synced_at, fromIso, toIso);
    if (!feedObserved && !googleSynced) continue;

    const subscriptionId = stringValue(subscription.id);
    for (const personKey of keysBySubscription.get(subscriptionId) ?? []) {
      verified.add(personKey);
    }
  }
  return verified;
}

function funnelStage(
  stage: string,
  people: number,
  previousPeople: number | null,
  firstPeople: number,
): AnalyticsFunnelStage {
  const conversionFromPrevious =
    previousPeople && previousPeople > 0 ? people / previousPeople : null;
  const conversionFromFirst = firstPeople > 0 ? people / firstPeople : null;
  const dropoffCount =
    previousPeople === null ? null : Math.max(previousPeople - people, 0);
  const dropoffRate =
    previousPeople && previousPeople > 0 && dropoffCount !== null
      ? dropoffCount / previousPeople
      : null;
  return {
    stage,
    people,
    conversionFromPrevious,
    conversionFromFirst,
    dropoffCount,
    dropoffRate,
  };
}

function buildTruthfulConversionFunnel(
  events: JsonRecord[],
  subscriptions: JsonRecord[],
  filters: AnalyticsFilters,
  fromIso: string,
  toIso: string,
) {
  const conversionEvents = conversionEventsForFilters(
    events,
    subscriptions,
    filters,
  );
  const viewers = uniquePersonKeys(conversionEvents, ["timetable_viewed"]);
  const starts = intersection(
    viewers,
    uniquePersonKeys(conversionEvents, ["calendar_cta_clicked"]),
  );
  const reminders = intersection(
    starts,
    uniquePersonKeys(conversionEvents, reminderEvents),
  );
  const providers = intersection(
    reminders,
    uniquePersonKeys(conversionEvents, providerSelectionEvents),
  );
  const handoffs = intersection(
    providers,
    uniquePersonKeys(conversionEvents, providerHandoffEvents),
  );
  const verified = intersection(
    handoffs,
    verifiedActivationPeople(
      conversionEvents,
      subscriptions,
      filters,
      fromIso,
      toIso,
    ),
  );

  const ordered = [
    ["timetable_viewed", viewers.size],
    ["add_to_calendar_started", starts.size],
    ["reminder_selected", reminders.size],
    ["provider_selected", providers.size],
    ["provider_handoff_prepared", handoffs.size],
    ["verified_activation", verified.size],
  ] as const;
  const firstPeople = ordered[0][1];

  return {
    funnel: ordered.map(([stage, people], index) =>
      funnelStage(
        stage,
        people,
        index === 0 ? null : ordered[index - 1][1],
        firstPeople,
      ),
    ),
    counts: {
      timetableViewers: viewers.size,
      addToCalendarStarts: uniquePersonKeys(conversionEvents, [
        "calendar_cta_clicked",
      ]).size,
      reminderSelections: uniquePersonKeys(conversionEvents, reminderEvents)
        .size,
      providerSelections: uniquePersonKeys(
        conversionEvents,
        providerSelectionEvents,
      ).size,
      providerHandoffs: uniquePersonKeys(
        conversionEvents,
        providerHandoffEvents,
      ).size,
      googleConnectionsCompleted:
        filters.provider && filters.provider !== "google_api"
          ? 0
          : verifiedActivationPeople(
              conversionEvents.filter((event) => {
                const provider = stringValue(event.provider);
                return (
                  provider === "google_api" ||
                  googleVerifiedEvents.includes(stringValue(event.event_name))
                );
              }),
              subscriptions.filter(
                (subscription) =>
                  stringValue(subscription.provider) === "google_api",
              ),
              { ...filters, provider: "google_api" },
              fromIso,
              toIso,
            ).size,
      googleConnectionFailures: uniquePersonKeys(
        conversionEvents,
        googleFailureEvents,
      ).size,
      verifiedActivations: verified.size,
      verifiedActivationConversion:
        firstPeople > 0 ? verified.size / firstPeople : null,
    },
  };
}

async function getFounderOperationsOverview(
  client: ReturnType<typeof createSupabaseAdminClient>,
  filters: AnalyticsFilters,
  row: JsonRecord | null,
): Promise<{
  operations: FounderOperationsOverview;
  conversionFunnel: AnalyticsFunnelStage[];
}> {
  const fromIso = `${filters.from}T00:00:00.000Z`;
  const toDate = new Date(`${filters.to}T00:00:00.000Z`);
  toDate.setUTCDate(toDate.getUTCDate() + 1);
  const toIso = toDate.toISOString();

  const [
    events,
    subscriptions,
    correctionDirectives,
    exceptions,
    staffUsers,
    classRepAssignments,
    sourceReviews,
    timetables,
  ] = await Promise.all([
    expectData<JsonRecord[]>(
      client
        .from("analytics_events")
        .select(
          "event_name, analytics_person_id, anonymous_id, subscription_id, timetable_id, public_slug, provider, properties, device_kind, browser_family, os_family, created_at",
        )
        .gte("created_at", fromIso)
        .lt("created_at", toIso),
      "Could not load dashboard analytics events",
    ),
    expectData<JsonRecord[]>(
      client
        .from("calendar_subscriptions")
        .select(
          "id, timetable_id, provider, status, subscriber_profile_id, last_feed_fetch_at, last_synced_at, created_at, timetables(id, public_slug, current_published_version_id, institutions(name, short_name), programmes(name), cohorts(label), academic_periods(name))",
        ),
      "Could not load dashboard subscription aggregates",
    ),
    expectData<JsonRecord[]>(
      client
        .from("timetable_correction_directives")
        .select("id, timetable_id, source_may_replace, active, created_at")
        .eq("active", true),
      "Could not load dashboard correction aggregates",
    ),
    expectData<JsonRecord[]>(
      client
        .from("timetable_session_exceptions")
        .select("id, timetable_id, active, exception_date, created_at")
        .eq("active", true),
      "Could not load dashboard exception aggregates",
    ),
    expectData<JsonRecord[]>(
      client.from("staff_users").select("id, role, active"),
      "Could not load dashboard staff aggregates",
    ),
    expectData<JsonRecord[]>(
      client
        .from("class_rep_assignments")
        .select("id, timetable_id, staff_user_id, active")
        .eq("active", true),
      "Could not load dashboard class rep assignment aggregates",
    ),
    expectData<JsonRecord[]>(
      client
        .from("timetable_source_reviews")
        .select("id, timetable_id, status, created_at, updated_at")
        .in("status", ["pending", "failed"]),
      "Could not load dashboard source review aggregates",
    ),
    expectData<JsonRecord[]>(
      client
        .from("timetables")
        .select(
          "id, public_slug, current_published_version_id, timetable_versions!timetables_current_published_version_id_fkey(id, published_at), institutions(name, short_name), programmes(name), cohorts(label), academic_periods(name)",
        )
        .not("current_published_version_id", "is", null),
      "Could not load dashboard timetable trust aggregates",
    ),
  ]);

  const safeEvents = events ?? [];
  const safeSubscriptions = subscriptions ?? [];
  const conversion = buildTruthfulConversionFunnel(
    safeEvents,
    safeSubscriptions,
    filters,
    fromIso,
    toIso,
  );
  const conversionEvents = conversionEventsForFilters(
    safeEvents,
    safeSubscriptions,
    filters,
  );
  const filteredSubscriptions = safeSubscriptions.filter((subscription) =>
    filters.provider
      ? stringValue(subscription.provider) === filters.provider
      : true,
  );
  const periodSubscriptions = filteredSubscriptions.filter((subscription) =>
    inWindow(subscription.created_at, fromIso, toIso),
  );
  const subscriptionsByTimetable = groupByTimetable(safeSubscriptions);
  const correctionsByTimetable = groupByTimetable(correctionDirectives ?? []);
  const exceptionsByTimetable = groupByTimetable(exceptions ?? []);
  const reviewsByTimetable = groupByTimetable(sourceReviews ?? []);
  const assignmentsByTimetable = groupByTimetable(classRepAssignments ?? []);

  const subscriberHealth = [...subscriptionsByTimetable.entries()].map(
    ([timetableId, rows]) => {
      const activeRows = rows.filter(
        (item) => stringValue(item.status) === "active",
      );
      const updateEnabledRows = activeRows.filter(
        (item) => stringValue(item.provider) !== "ics_download",
      );
      const providerMix = activeRows.reduce<Record<string, number>>(
        (summary, item) => {
          const provider = stringValue(item.provider) || "unknown";
          summary[provider] = (summary[provider] ?? 0) + 1;
          return summary;
        },
        {},
      );
      const feedObservedAt = activeRows
        .map((item) => nullableString(item.last_feed_fetch_at))
        .filter((item): item is string => Boolean(item))
        .sort()
        .at(-1);
      const timetable = asSingle(
        rows[0]?.timetables as JsonRecord | JsonRecord[] | null,
      );
      return {
        timetableId,
        publicSlug: stringValue(timetable?.public_slug),
        label: tableLabel(rows[0]) || timetableId,
        activeSubscriptions: activeRows.length,
        updateEnabledSubscriptions: updateEnabledRows.length,
        oneTimeIcsDownloads: activeRows.filter(
          (item) => stringValue(item.provider) === "ics_download",
        ).length,
        contactableSubscriptions: activeRows.filter((item) =>
          Boolean(item.subscriber_profile_id),
        ).length,
        feedObservedSubscriptions: activeRows.filter(
          (item) =>
            stringValue(item.provider) !== "ics_download" &&
            Boolean(item.last_feed_fetch_at),
        ).length,
        lastFeedObservedAt: feedObservedAt ?? null,
        providerMix,
      };
    },
  );

  const timetableTrust = (timetables ?? []).map((timetable) => {
    const timetableId = stringValue(timetable.id);
    const pinnedCorrections = (
      correctionsByTimetable.get(timetableId) ?? []
    ).filter((correction) => correction.source_may_replace === false).length;
    const pendingExceptions = (exceptionsByTimetable.get(timetableId) ?? [])
      .length;
    const unresolvedSourceReviews = (reviewsByTimetable.get(timetableId) ?? [])
      .length;
    const hasClassRep = Boolean(
      assignmentsByTimetable.get(timetableId)?.length,
    );
    const version = asSingle(
      timetable.timetable_versions as JsonRecord | JsonRecord[] | null,
    );
    const warnings = [
      unresolvedSourceReviews > 0 ? "Source review needs attention" : null,
      pinnedCorrections > 0 ? "Pinned Class Rep correction active" : null,
      pendingExceptions > 0 ? "Pending date exception active" : null,
      !hasClassRep ? "No Class Rep assigned" : null,
    ].filter((item): item is string => Boolean(item));
    return {
      timetableId,
      publicSlug: stringValue(timetable.public_slug),
      label: tableLabel({ timetables: timetable }) || timetableId,
      currentPublishedAt: nullableString(version?.published_at),
      latestSourceSnapshotAt: null,
      unresolvedSourceReviews,
      pinnedCorrections,
      pendingExceptions,
      hasClassRep,
      warnings,
    };
  });

  const legacyOnboarded = eventCountByName(conversionEvents, [
    "onboarding_completed",
    "google_oauth_completed",
  ]);
  const legacyPreparationRate =
    conversion.counts.timetableViewers > 0
      ? numberValue(row?.calendar_activation_rate)
      : null;

  const operations: FounderOperationsOverview = {
    pilotPulse: {
      uniqueTimetableViewers: conversion.counts.timetableViewers,
      addToCalendarStarts: conversion.counts.addToCalendarStarts,
      reminderSelections: conversion.counts.reminderSelections,
      providerSelections: conversion.counts.providerSelections,
      providerHandoffs: conversion.counts.providerHandoffs,
      googleConnectionsCompleted: conversion.counts.googleConnectionsCompleted,
      googleConnectionFailures: conversion.counts.googleConnectionFailures,
      verifiedActivations: conversion.counts.verifiedActivations,
      verifiedActivationConversion:
        conversion.counts.verifiedActivationConversion,
      calendarSubscriptionsCreated: periodSubscriptions.length,
      updateEnabledSubscriptions: periodSubscriptions.filter(
        (subscription) =>
          stringValue(subscription.status) === "active" &&
          stringValue(subscription.provider) !== "ics_download",
      ).length,
      oneTimeIcsDownloads:
        filters.provider && filters.provider !== "ics_download"
          ? 0
          : eventCountByName(conversionEvents, ["ics_download_completed"]),
      feedObservedSubscriptions: filteredSubscriptions.filter(
        (subscription) =>
          stringValue(subscription.status) === "active" &&
          stringValue(subscription.provider) !== "ics_download" &&
          inWindow(subscription.last_feed_fetch_at, fromIso, toIso),
      ).length,
      shares: eventCountByName(conversionEvents, ["timetable_shared"]),
      onboardingStarts: eventCountByName(conversionEvents, [
        "calendar_cta_clicked",
        "onboarding_opened",
      ]),
      onboardingCompletions: legacyOnboarded,
      activationConversion: legacyPreparationRate,
      legacyConnectionPreparationRate: legacyPreparationRate,
    },
    subscriberHealth,
    timetableTrust,
    classRepOperations: {
      activeClassReps: (staffUsers ?? []).filter(
        (staff) => staff.role === "class_rep" && staff.active === true,
      ).length,
      assignedTimetables: new Set(
        (classRepAssignments ?? []).map((assignment) =>
          stringValue(assignment.timetable_id),
        ),
      ).size,
      unassignedPublishedTimetables: timetableTrust.filter(
        (timetable) => !timetable.hasClassRep,
      ).length,
      recentCorrections: (correctionDirectives ?? []).filter((correction) => {
        const createdAt = nullableString(correction.created_at);
        return createdAt ? createdAt >= fromIso : false;
      }).length,
    },
  };

  return { operations, conversionFunnel: conversion.funnel };
}

export async function getAnalyticsOverview(
  filters: AnalyticsFilters,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AnalyticsOverview> {
  const client = createSupabaseAdminClient(env);
  const { data, error } = await client.rpc("get_admin_analytics_overview", {
    p_from: filters.from,
    p_to: filters.to,
    p_timezone: filters.timezone,
    p_institution_id: filters.institutionId ?? null,
    p_programme_id: filters.programmeId ?? null,
    p_class_group_id: filters.classGroupId ?? null,
    p_timetable_id: filters.timetableId ?? null,
    p_provider: filters.provider ?? null,
    p_device_kind: filters.deviceKind ?? null,
    p_browser_family: filters.browserFamily ?? null,
    p_os_family: filters.osFamily ?? null,
    p_utm_source: filters.utmSource ?? null,
    p_stage: filters.stage ?? null,
  });
  if (error) {
    throw new Error(`analytics overview query failed: ${error.message}`);
  }

  const row = (Array.isArray(data) ? data[0] : data) as JsonRecord | null;
  const { operations, conversionFunnel } = await getFounderOperationsOverview(
    client,
    filters,
    row,
  );
  const verifiedActivationRate =
    operations.pilotPulse.verifiedActivationConversion ?? 0;

  return {
    filters,
    refreshedAt: new Date().toISOString(),
    aggregateFreshnessMinutes: row?.aggregate_freshness_minutes
      ? numberValue(row.aggregate_freshness_minutes)
      : null,
    kpis: [
      {
        id: "activeCalendarConnections",
        label: "Active update-enabled records",
        value: numberValue(row?.active_calendar_connections),
        comparisonValue: null,
        delta: null,
        definitionId: "activeCalendarConnections",
      },
      {
        id: "uniqueTimetableViewers",
        label: "Unique timetable viewers",
        value: operations.pilotPulse.uniqueTimetableViewers,
        comparisonValue: null,
        delta: null,
        definitionId: "uniqueTimetableViewers",
      },
      {
        id: "verifiedCalendarActivationRate",
        label: "Verified activation rate",
        value: verifiedActivationRate,
        comparisonValue: null,
        delta: null,
        definitionId: "verifiedCalendarActivationRate",
      },
      {
        id: "calendarActivationRate",
        label: "Historical connection preparation rate",
        value: numberValue(row?.calendar_activation_rate),
        comparisonValue: null,
        delta: null,
        definitionId: "calendarActivationRate",
      },
      {
        id: "newCalendarConnections",
        label: "New connection records",
        value: numberValue(row?.new_calendar_connections),
        comparisonValue: null,
        delta: null,
        definitionId: "activeCalendarConnections",
      },
      {
        id: "healthyFeedSyncRate",
        label: "Healthy feed/sync rate",
        value: numberValue(row?.feed_health_rate),
        comparisonValue: null,
        delta: null,
        definitionId: "feedHealthRate",
      },
    ],
    providerMix: Array.isArray(row?.provider_mix)
      ? (row.provider_mix as JsonRecord[]).map((item) => ({
          provider: stringValue(item.provider),
          setupChoices: numberValue(item.setupChoices),
          activeConnections: numberValue(item.activeConnections),
        }))
      : [],
    adoptionTimeseries: Array.isArray(row?.adoption_timeseries)
      ? (row.adoption_timeseries as JsonRecord[]).map((item) => ({
          date: stringValue(item.date),
          uniquePeople: numberValue(item.uniquePeople),
          timetableViews: numberValue(item.timetableViews),
          onboardingStarts: numberValue(item.onboardingStarts),
          calendarConnections: numberValue(item.calendarConnections),
          googleConnections: numberValue(item.googleConnections),
          shares: numberValue(item.shares),
        }))
      : [],
    funnel: Array.isArray(row?.funnel)
      ? (row.funnel as AnalyticsOverview["funnel"])
      : [],
    conversionFunnel,
    dataQuality: {
      eventsReceived: numberValue(row?.events_received),
      uniqueAnonymousIdentities: numberValue(row?.unique_anonymous_identities),
      identitiesStitchedToSubscriptions: numberValue(
        row?.identities_stitched_to_subscriptions,
      ),
      consentedContactLinkageRate: numberValue(
        row?.consented_contact_linkage_rate,
      ),
      missingTimetableContext: numberValue(row?.missing_timetable_context),
      missingSubscriptionLinkage: numberValue(
        row?.missing_subscription_linkage,
      ),
      identityStitchingRate: numberValue(row?.identity_stitching_rate),
      knownVsAnonymousRatio: numberValue(row?.known_vs_anonymous_ratio),
      lastIngestionAt: row?.last_ingestion_at
        ? String(row.last_ingestion_at)
        : null,
      persistenceFailures:
        row?.persistence_failures === null ||
        row?.persistence_failures === undefined
          ? null
          : numberValue(row.persistence_failures),
      unexpectedEventNames: Array.isArray(row?.unexpected_event_names)
        ? row.unexpected_event_names.map(String)
        : [],
      knownHistoricalInstrumentationGaps: [
        ...(Array.isArray(row?.known_historical_instrumentation_gaps)
          ? row.known_historical_instrumentation_gaps.map(String)
          : []),
        "DR-65: historical calendarActivationRate is connection preparation, not verified activation.",
        "DR-65: strict conversion-funnel entry-path segmentation only applies where privacy-safe entryPath instrumentation exists.",
      ],
    },
    operations: operations ?? emptyFounderOperationsOverview,
  };
}

export function getMetricDefinitions() {
  return ANALYTICS_METRIC_REGISTRY;
}
