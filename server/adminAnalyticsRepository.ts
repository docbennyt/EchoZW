import { ANALYTICS_METRIC_REGISTRY } from "../src/domain/analyticsMetrics.js";
import type {
  AnalyticsFilters,
  AnalyticsOverview,
} from "../src/domain/adminAnalytics.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

type JsonRecord = Record<string, unknown>;

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
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
  };
}

export function getMetricDefinitions() {
  return ANALYTICS_METRIC_REGISTRY;
}
