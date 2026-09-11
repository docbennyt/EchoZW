export type MetricDefinition = {
  id: string;
  name: string;
  businessMeaning: string;
  numerator: string;
  denominator: string | null;
  timeSemantics: string;
  identitySemantics: string;
  limitations: string;
};

export const ANALYTICS_METRIC_REGISTRY: MetricDefinition[] = [
  {
    id: "activeCalendarConnections",
    name: "Active update-enabled records",
    businessMeaning:
      "Active calendar subscription records that are capable of receiving timetable updates.",
    numerator:
      "Active calendar subscription records whose provider is Google direct, Apple subscription, webcal subscription, or Outlook subscription.",
    denominator: null,
    timeSemantics:
      "Current-state metric; it is a record-state measure, not proof that a calendar client has consumed updates.",
    identitySemantics:
      "Counts subscription records, not people. One-time ICS downloads are excluded.",
    limitations:
      "A created or active record is preparation evidence only. Verified activation requires Google success/sync evidence or an observed feed request.",
  },
  {
    id: "uniqueTimetableViewers",
    name: "Unique timetable viewers",
    businessMeaning:
      "Distinct analytics people who reached a public timetable in the selected period.",
    numerator:
      "Unique analytics_person_id values, falling back to anonymous analytics identity when stitching is unavailable, with timetable_viewed events.",
    denominator: null,
    timeSemantics:
      "Event created_at within the selected founder timezone range.",
    identitySemantics:
      "Anonymous IDs are only joined to people through deterministic product links.",
    limitations:
      "Cross-device users remain separate unless a deterministic subscription/contact link exists.",
  },
  {
    id: "calendarActivationRate",
    name: "Historical connection preparation rate",
    businessMeaning:
      "Legacy rate retained so historical dashboards remain readable. It reflects connection/subscription preparation, not verified calendar activation.",
    numerator:
      "Legacy RPC numerator based on historical connection-creation semantics.",
    denominator:
      "Unique analytics people who viewed a timetable in the same filtered period.",
    timeSemantics:
      "Historical compatibility metric. Existing rows and prior calculations are not redefined by DR-65.",
    identitySemantics: "Unique people, not raw event counts.",
    limitations:
      "Do not interpret this metric as verified activation. Subscription record creation and provider handoff can occur without the calendar ever consuming updates.",
  },
  {
    id: "verifiedCalendarActivationRate",
    name: "Verified calendar activation rate",
    businessMeaning:
      "Share of timetable viewers who reached a stronger activation signal after completing the primary conversion path.",
    numerator:
      "Unique people in the primary funnel with successful Google calendar creation/sync evidence or a subscription-linked observed feed request.",
    denominator:
      "Unique people with timetable_viewed evidence in the same filtered conversion cohort.",
    timeSemantics:
      "Evidence is evaluated inside the selected date window. Feed observation uses last_feed_fetch_at; Google uses success/sync evidence.",
    identitySemantics:
      "Counts people only when analytics identity evidence can be tied deterministically to the successful Google or subscription signal.",
    limitations:
      "Feed observation proves a calendar client requested the feed, not that a human opened the calendar. Historical journeys missing intermediate instrumentation may be excluded from the strict funnel.",
  },
  {
    id: "providerHandoffs",
    name: "Provider handoffs / preparations",
    businessMeaning:
      "Students who reached a provider preparation or handoff signal after provider selection.",
    numerator:
      "Unique analytics people with subscription preparation, Google OAuth start, Apple/webcal open, subscription-link copy, or ICS-start evidence.",
    denominator: null,
    timeSemantics: "Events created in the selected period.",
    identitySemantics: "Unique analytics people, not raw event counts.",
    limitations:
      "A handoff is not verified activation and must never be combined with the verified activation numerator.",
  },
  {
    id: "googleConnectionsCompleted",
    name: "Google connections completed",
    businessMeaning:
      "Students with successful direct Google calendar creation/sync evidence.",
    numerator:
      "Unique analytics people with google_calendar_created or google_calendar_sync_completed evidence, plus deterministically linked active Google records with last_synced_at evidence.",
    denominator: null,
    timeSemantics: "Success/sync evidence in the selected period.",
    identitySemantics:
      "Unique analytics people when deterministic identity evidence exists.",
    limitations:
      "google_oauth_started and google_oauth_failed are not success. OAuth completion alone is not used as the final activation proof.",
  },
  {
    id: "feedObservedSubscriptions",
    name: "Feed-observed subscriptions",
    businessMeaning:
      "Update-enabled subscription records for which a calendar client actually requested the feed.",
    numerator:
      "Active non-ICS calendar subscriptions whose last_feed_fetch_at falls in the selected period.",
    denominator: null,
    timeSemantics: "Uses durable last_feed_fetch_at server evidence.",
    identitySemantics: "Counts subscription records, not people.",
    limitations:
      "This is stronger than record creation but still does not prove a human viewed a calendar event.",
  },
  {
    id: "oneTimeIcsDownloads",
    name: "One-time ICS downloads",
    businessMeaning:
      "Completed one-time ICS file downloads that will not receive future timetable changes.",
    numerator: "ics_download_completed events.",
    denominator: null,
    timeSemantics: "Events created in the selected period.",
    identitySemantics: "Counts completed download events.",
    limitations:
      "Never included in update-enabled or verified-activation metrics.",
  },
  {
    id: "googleOauthCompletionRate",
    name: "Google OAuth completion rate",
    businessMeaning:
      "How reliably students who start Google connection complete OAuth callback.",
    numerator: "Unique people with google_oauth_completed.",
    denominator: "Unique people with google_oauth_started.",
    timeSemantics: "OAuth events created in the selected period.",
    identitySemantics: "Unique analytics people.",
    limitations:
      "Failure classes are normalized; raw Google errors are never exposed. OAuth completion is an intermediate signal, not the final verified-activation metric.",
  },
  {
    id: "shareToViewRate",
    name: "Share-to-view rate",
    businessMeaning:
      "How often privacy-safe class sharing creates new timetable viewers.",
    numerator: "Unique shared-link opens that become timetable viewers.",
    denominator: "Unique share-link opens with a shareAttributionId.",
    timeSemantics: "Share attribution events created in the selected period.",
    identitySemantics:
      "Recipients are not shown the sharer's private identity; attribution is coarse.",
    limitations:
      "Historical rows without shareAttributionId are labeled as an attribution gap.",
  },
  {
    id: "feedHealthRate",
    name: "Healthy feed/sync rate",
    businessMeaning:
      "Share of update-capable connections with recent successful feed or Google sync activity.",
    numerator:
      "Active update-capable connections whose latest health signal is within the provider-specific threshold.",
    denominator: "Active update-capable connections.",
    timeSemantics:
      "Current-state metric, with last activity timestamps preserved.",
    identitySemantics: "Counts connections, not human calendar opens.",
    limitations:
      "This is connection health, not proof that a student opened their calendar.",
  },
  {
    id: "correctionPropagationLatency",
    name: "Correction propagation latency",
    businessMeaning:
      "Time from a Class Rep correction to the next feed delivery or Google sync of the affected timetable.",
    numerator:
      "Elapsed time between correction created_at and first qualifying delivery/sync after the correction.",
    denominator: null,
    timeSemantics:
      "Measured per correction and summarized with median and attention thresholds.",
    identitySemantics: "Counts affected update-capable connections.",
    limitations:
      "Provider polling schedules mean delay is not automatically a CalenderZW failure.",
  },
];

export function metricDefinitionById(id: string) {
  return ANALYTICS_METRIC_REGISTRY.find((metric) => metric.id === id) ?? null;
}
