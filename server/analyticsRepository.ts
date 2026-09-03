import type {
  AnalyticsEventName,
  AnalyticsProperties,
  CoarseClient,
} from "../src/domain/analytics.js";
import { isAnalyticsUuid } from "../src/domain/analytics.js";
import { createSupabaseAdminClient } from "./supabase/adminClient.js";

export type AnalyticsEventInsert = {
  productKey: string;
  eventName: AnalyticsEventName;
  anonymousId: string;
  sessionId: string;
  timetableId?: string | null;
  subscriptionId?: string | null;
  publicSlug?: string | null;
  provider?: string | null;
  properties: AnalyticsProperties;
  clientTimestamp?: string | null;
  client: CoarseClient;
};

type AnalyticsPersistenceClient = ReturnType<typeof createSupabaseAdminClient>;

async function resolveAnalyticsPersonId(
  client: AnalyticsPersistenceClient,
  event: AnalyticsEventInsert,
) {
  try {
    const subscriptionId =
      event.subscriptionId && isAnalyticsUuid(event.subscriptionId)
        ? event.subscriptionId
        : null;
    const seenAt =
      event.clientTimestamp && !Number.isNaN(Date.parse(event.clientTimestamp))
        ? event.clientTimestamp
        : new Date().toISOString();
    const { data, error } = await client.rpc("resolve_analytics_person", {
      p_product_key: event.productKey,
      p_anonymous_id: event.anonymousId,
      p_subscription_id: subscriptionId,
      p_seen_at: seenAt,
    });
    if (error) throw error;
    return typeof data === "string" ? data : null;
  } catch (error) {
    console.warn("analytics identity stitching unavailable", {
      eventName: event.eventName,
      hasSubscriptionId: Boolean(event.subscriptionId),
      error: error instanceof Error ? error.message : "unknown",
    });
    return null;
  }
}

export async function persistAnalyticsEvents(
  events: AnalyticsEventInsert[],
  env: NodeJS.ProcessEnv = process.env,
) {
  if (events.length === 0) return;
  const client = createSupabaseAdminClient(env);
  const rows = [];
  for (const event of events) {
    const analyticsPersonId = await resolveAnalyticsPersonId(client, event);
    rows.push({
      product_key: event.productKey,
      event_name: event.eventName,
      anonymous_id: event.anonymousId,
      session_id: event.sessionId,
      timetable_id: event.timetableId ?? null,
      subscription_id: event.subscriptionId ?? null,
      analytics_person_id: analyticsPersonId,
      public_slug: event.publicSlug ?? null,
      provider: event.provider ?? null,
      properties: event.properties,
      client_created_at: event.clientTimestamp ?? null,
      device_kind: event.client.deviceKind,
      browser_family: event.client.browserFamily,
      os_family: event.client.osFamily,
    });
  }
  const { error } = await client.from("analytics_events").insert(rows);
  if (error) {
    throw new Error(`analytics insert failed: ${error.message}`);
  }
}

export async function recordCalendarFeedActivity(
  input: {
    subscriptionId: string;
    statusCode: 200 | 304;
    client: CoarseClient;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const client = createSupabaseAdminClient(env);
  const { error } = await client.rpc("record_calendar_feed_activity", {
    p_subscription_id: input.subscriptionId,
    p_status_code: input.statusCode,
    p_device_kind: input.client.deviceKind,
    p_browser_family: input.client.browserFamily,
    p_os_family: input.client.osFamily,
  });
  if (error) {
    throw new Error(`calendar feed activity insert failed: ${error.message}`);
  }
}
