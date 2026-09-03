import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsEventInsert } from "../server/analyticsRepository";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import { persistAnalyticsEvents } from "../server/analyticsRepository";

const baseEvent = {
  productKey: "calenderzw",
  eventName: "calendar_subscription_created",
  anonymousId: "4b3f08c9-78b7-4af5-9a2b-dc859fabcf63",
  sessionId: "a9f5cf94-9509-4120-b07a-69a1b9ba7811",
  timetableId: "31d3e7d4-0080-4f6a-98ef-7e9de260e8fb",
  subscriptionId: "bd941653-146e-4c63-bdc9-b332a3b477a1",
  publicSlug: "cs-1-1",
  provider: "google_api",
  properties: { subscriptionId: "bd941653-146e-4c63-bdc9-b332a3b477a1" },
  clientTimestamp: "2026-09-03T10:00:00.000Z",
  client: {
    deviceKind: "mobile",
    browserFamily: "chrome",
    osFamily: "android",
  },
} satisfies AnalyticsEventInsert;

describe("analytics repository identity stitching", () => {
  beforeEach(() => {
    adminClientMocks.createSupabaseAdminClient.mockReset();
  });

  it("attaches a resolved analytics person id to persisted events", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({
      data: "8bb89ca6-3509-47af-a667-a7db193239f1",
      error: null,
    }));
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ insert })),
    });

    await persistAnalyticsEvents([baseEvent], {});

    expect(rpc).toHaveBeenCalledWith("resolve_analytics_person", {
      p_product_key: "calenderzw",
      p_anonymous_id: baseEvent.anonymousId,
      p_subscription_id: baseEvent.subscriptionId,
      p_seen_at: baseEvent.clientTimestamp,
    });
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        analytics_person_id: "8bb89ca6-3509-47af-a667-a7db193239f1",
        provider: "google_api",
      }),
    ]);
  });

  it("persists raw events when identity stitching is unavailable", async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: "temporary lock timeout" },
    }));
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      rpc,
      from: vi.fn(() => ({ insert })),
    });

    await persistAnalyticsEvents([baseEvent], {});

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        analytics_person_id: null,
        event_name: "calendar_subscription_created",
      }),
    ]);
  });
});
