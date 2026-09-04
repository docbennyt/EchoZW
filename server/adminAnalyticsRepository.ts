import { ANALYTICS_METRIC_REGISTRY } from "../src/domain/analyticsMetrics.js";
import type {
  AnalyticsFilters,
  AnalyticsOverview,
  FounderOperationsOverview,
} from "../src/domain/adminAnalytics.js";
import { emptyFounderOperationsOverview } from "../src/domain/adminAnalytics.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;
type QueryResult<T> = { data: T | null; error: { message?: string } | null };

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

async function getFounderOperationsOverview(
  client: ReturnType<typeof createSupabaseAdminClient>,
  filters: AnalyticsFilters,
  row: JsonRecord | null,
): Promise<FounderOperationsOverview> {
  const fromIso = `${filters.from}T00:00:00.000Z`;
  const toIso = new Date(`${filters.to}T00:00:00.000Z`);
  toIso.setUTCDate(toIso.getUTCDate() + 1);

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
          "event_name, timetable_id, public_slug, provider, device_kind, created_at",
        )
        .gte("created_at", fromIso)
        .lt("created_at", toIso.toISOString()),
      "Could not load dashboard analytics events",
    ),
    expectData<JsonRecord[]>(
      client
        .from("calendar_subscriptions")
        .select(
          "id, timetable_id, provider, status, subscriber_profile_id, last_feed_fetch_at, created_at, timetables(id, public_slug, current_published_version_id, institutions(name, short_name), programmes(name), cohorts(label), academic_periods(name))",
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
        feedObservedSubscriptions: activeRows.filter((item) =>
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

  const onboarded = eventCountByName(safeEvents, [
    "onboarding_completed",
    "calendar_onboarding_completed",
    "google_oauth_completed",
  ]);
  const viewers = numberValue(row?.unique_timetable_viewers);

  return {
    pilotPulse: {
      uniqueTimetableViewers: viewers,
      onboardingStarts: eventCountByName(safeEvents, [
        "calendar_cta_clicked",
        "subscribe_opened",
        "onboarding_started",
      ]),
      onboardingCompletions: onboarded,
      calendarSubscriptionsCreated: numberValue(row?.new_calendar_connections),
      updateEnabledSubscriptions: safeSubscriptions.filter(
        (subscription) =>
          stringValue(subscription.status) === "active" &&
          stringValue(subscription.provider) !== "ics_download",
      ).length,
      oneTimeIcsDownloads: safeSubscriptions.filter(
        (subscription) =>
          stringValue(subscription.status) === "active" &&
          stringValue(subscription.provider) === "ics_download",
      ).length,
      feedObservedSubscriptions: safeSubscriptions.filter((subscription) =>
        Boolean(subscription.last_feed_fetch_at),
      ).length,
      shares: eventCountByName(safeEvents, [
        "timetable_shared",
        "class_link_shared_after_feedback",
      ]),
      activationConversion:
        viewers > 0 ? numberValue(row?.calendar_activation_rate) : null,
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
  const operations = await getFounderOperationsOverview(client, filters, row);

  return {
    filters,
    refreshedAt: new Date().toISOString(),
    aggregateFreshnessMinutes: row?.aggregate_freshness_minutes
      ? numberValue(row.aggregate_freshness_minutes)
      : null,
    kpis: [
      {
        id: "activeCalendarConnections",
        label: "Active calendar connections",
        value: numberValue(row?.active_calendar_connections),
        comparisonValue: null,
        delta: null,
        definitionId: "activeCalendarConnections",
      },
      {
        id: "uniqueTimetableViewers",
        label: "Unique timetable viewers",
        value: numberValue(row?.unique_timetable_viewers),
        comparisonValue: null,
        delta: null,
        definitionId: "uniqueTimetableViewers",
      },
      {
        id: "calendarActivationRate",
        label: "Calendar activation rate",
        value: numberValue(row?.calendar_activation_rate),
        comparisonValue: null,
        delta: null,
        definitionId: "calendarActivationRate",
      },
      {
        id: "newCalendarConnections",
        label: "New connections",
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
      knownHistoricalInstrumentationGaps: Array.isArray(
        row?.known_historical_instrumentation_gaps,
      )
        ? row.known_historical_instrumentation_gaps.map(String)
        : [],
    },
    operations: operations ?? emptyFounderOperationsOverview,
  };
}

export function getMetricDefinitions() {
  return ANALYTICS_METRIC_REGISTRY;
}
