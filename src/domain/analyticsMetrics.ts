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
    name: "Active calendar connections",
    businessMeaning:
      "Update-capable calendar connections currently available for timetable updates.",
    numerator:
      "Active calendar subscriptions whose provider is Google direct, Apple subscription, webcal subscription, or Outlook subscription.",
    denominator: null,
    timeSemantics:
      "Current-state metric; comparison uses connections created or active during the selected period.",
    identitySemantics:
      "Counts subscriptions, not people. One-time ICS downloads are excluded.",
    limitations:
      "Provider-controlled polling delays are not failures unless health thresholds mark them stale.",
  },
  {
    id: "uniqueTimetableViewers",
    name: "Unique timetable viewers",
    businessMeaning:
      "Distinct analytics people who reached a public timetable in the selected period.",
    numerator:
      "Unique analytics_person_id values with timetable_viewed events.",
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
    name: "Calendar activation rate",
    businessMeaning:
      "Share of timetable viewers who created an update-capable calendar connection.",
    numerator:
      "Unique analytics people who created a live Google, Apple, webcal, or Outlook connection.",
    denominator:
      "Unique analytics people who viewed a timetable in the same filtered period.",
    timeSemantics:
      "Uses first qualifying events within the selected date range.",
    identitySemantics: "Unique people, not raw event counts.",
    limitations:
      "ICS downloads are reported separately and are not active subscriptions.",
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
      "Failure classes are normalized; raw Google errors are never exposed.",
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
