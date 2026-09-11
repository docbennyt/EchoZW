import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
  })),
}));

import { getAnalyticsOverview } from "../server/adminAnalyticsRepository";

function queryResult(data: unknown) {
  const result = Promise.resolve({ data, error: null });
  const chain = {
    gte: vi.fn(() => ({
      lt: vi.fn(() => result),
    })),
    eq: vi.fn(() => result),
    in: vi.fn(() => result),
    not: vi.fn(() => result),
    then: result.then.bind(result),
  };
  return {
    select: vi.fn(() => chain),
  };
}

const path = "/t/hit-se-1";
const event = (
  person: string,
  eventName: string,
  options: {
    provider?: string;
    subscriptionId?: string;
    deviceKind?: string;
    entryPath?: string;
  } = {},
) => ({
  event_name: eventName,
  analytics_person_id: person,
  anonymous_id: `anon-${person}`,
  subscription_id: options.subscriptionId ?? null,
  provider: options.provider ?? null,
  device_kind: options.deviceKind ?? "mobile",
  browser_family: "chrome",
  os_family: options.deviceKind === "desktop" ? "windows" : "android",
  properties: { entryPath: options.entryPath ?? path },
  created_at: "2026-09-04T09:00:00.000Z",
});

const events = [
  event("p-viewer", "timetable_viewed"),
  event("p-apple-prepared", "timetable_viewed"),
  event("p-apple-prepared", "calendar_cta_clicked"),
  event("p-apple-prepared", "reminder_selected"),
  event("p-apple-prepared", "provider_selected", {
    provider: "apple_subscription",
  }),
  event("p-apple-prepared", "subscription_created", {
    provider: "apple_subscription",
    subscriptionId: "sub-apple-prepared",
  }),
  event("p-apple-feed", "timetable_viewed"),
  event("p-apple-feed", "calendar_cta_clicked"),
  event("p-apple-feed", "reminder_selected"),
  event("p-apple-feed", "provider_selected", {
    provider: "apple_subscription",
  }),
  event("p-apple-feed", "subscription_created", {
    provider: "apple_subscription",
    subscriptionId: "sub-apple-feed",
  }),
  event("p-apple-feed", "timetable_shared"),
  event("p-google", "timetable_viewed", { deviceKind: "desktop" }),
  event("p-google", "calendar_cta_clicked", { deviceKind: "desktop" }),
  event("p-google", "reminder_selected", { deviceKind: "desktop" }),
  event("p-google", "provider_selected", {
    provider: "google_api",
    deviceKind: "desktop",
  }),
  event("p-google", "subscription_created", {
    provider: "google_api",
    subscriptionId: "sub-google",
    deviceKind: "desktop",
  }),
  event("p-google", "google_oauth_started", {
    provider: "google_api",
    subscriptionId: "sub-google",
    deviceKind: "desktop",
  }),
  event("p-google", "google_calendar_created", {
    provider: "google_api",
    subscriptionId: "sub-google",
    deviceKind: "desktop",
  }),
  event("p-google", "google_calendar_sync_completed", {
    provider: "google_api",
    subscriptionId: "sub-google",
    deviceKind: "desktop",
  }),
  event("p-ics", "timetable_viewed"),
  event("p-ics", "calendar_cta_clicked"),
  event("p-ics", "reminder_selected"),
  event("p-ics", "provider_selected", { provider: "ics_download" }),
  event("p-ics", "subscription_created", {
    provider: "ics_download",
    subscriptionId: "sub-ics",
  }),
  event("p-ics", "ics_download_started", { subscriptionId: "sub-ics" }),
  event("p-ics", "ics_download_completed", { subscriptionId: "sub-ics" }),
  event("p-google-failed", "timetable_viewed"),
  event("p-google-failed", "calendar_cta_clicked"),
  event("p-google-failed", "reminder_selected"),
  event("p-google-failed", "provider_selected", { provider: "google_api" }),
  event("p-google-failed", "subscription_created", {
    provider: "google_api",
    subscriptionId: "sub-google-failed",
  }),
  event("p-google-failed", "google_oauth_started", {
    provider: "google_api",
    subscriptionId: "sub-google-failed",
  }),
  event("p-google-failed", "google_oauth_failed", {
    provider: "google_api",
    subscriptionId: "sub-google-failed",
  }),
];

const timetable = {
  id: "tt-1",
  public_slug: "hit-se-1",
  current_published_version_id: "version-1",
  institutions: { short_name: "HIT", name: "HIT" },
  programmes: { name: "Software Engineering" },
  cohorts: { label: "Part 1.1" },
};

const subscriptions = [
  {
    id: "sub-apple-prepared",
    timetable_id: "tt-1",
    provider: "apple_subscription",
    status: "active",
    subscriber_profile_id: "profile-secret",
    last_feed_fetch_at: null,
    last_synced_at: null,
    created_at: "2026-09-04T09:00:00.000Z",
    token_hash: "must-not-be-selected",
    timetables: timetable,
  },
  {
    id: "sub-apple-feed",
    timetable_id: "tt-1",
    provider: "apple_subscription",
    status: "active",
    subscriber_profile_id: null,
    last_feed_fetch_at: "2026-09-04T10:00:00.000Z",
    last_synced_at: null,
    created_at: "2026-09-04T09:00:00.000Z",
    timetables: timetable,
  },
  {
    id: "sub-google",
    timetable_id: "tt-1",
    provider: "google_api",
    status: "active",
    subscriber_profile_id: null,
    last_feed_fetch_at: null,
    last_synced_at: "2026-09-04T10:05:00.000Z",
    created_at: "2026-09-04T09:00:00.000Z",
    timetables: timetable,
  },
  {
    id: "sub-ics",
    timetable_id: "tt-1",
    provider: "ics_download",
    status: "active",
    subscriber_profile_id: null,
    last_feed_fetch_at: null,
    last_synced_at: null,
    created_at: "2026-09-04T09:00:00.000Z",
    timetables: timetable,
  },
  {
    id: "sub-google-failed",
    timetable_id: "tt-1",
    provider: "google_api",
    status: "failed",
    subscriber_profile_id: null,
    last_feed_fetch_at: null,
    last_synced_at: null,
    created_at: "2026-09-04T09:00:00.000Z",
    timetables: timetable,
  },
];

beforeEach(() => {
  mockRpc.mockReset();
  mockFrom.mockReset();
  mockRpc.mockResolvedValue({
    data: {
      active_calendar_connections: 3,
      unique_timetable_viewers: 99,
      calendar_activation_rate: 0.75,
      new_calendar_connections: 5,
      feed_health_rate: 0.5,
      provider_mix: [],
      adoption_timeseries: [],
      funnel: [{ stage: "legacy", people: 99 }],
      events_received: events.length,
    },
    error: null,
  });
  mockFrom.mockImplementation((tableName: string) => {
    if (tableName === "analytics_events") return queryResult(events);
    if (tableName === "calendar_subscriptions")
      return queryResult(subscriptions);
    if (tableName === "timetable_correction_directives") {
      return queryResult([
        {
          id: "correction-1",
          timetable_id: "tt-1",
          source_may_replace: false,
          active: true,
          created_at: "2026-09-04T08:00:00.000Z",
        },
      ]);
    }
    if (tableName === "timetable_session_exceptions") {
      return queryResult([
        { id: "exception-1", timetable_id: "tt-1", active: true },
      ]);
    }
    if (tableName === "staff_users") {
      return queryResult([{ id: "staff-1", role: "class_rep", active: true }]);
    }
    if (tableName === "class_rep_assignments") {
      return queryResult([
        {
          id: "assignment-1",
          timetable_id: "tt-1",
          staff_user_id: "staff-1",
          active: true,
        },
      ]);
    }
    if (tableName === "timetable_source_reviews") {
      return queryResult([
        { id: "review-1", timetable_id: "tt-1", status: "pending" },
      ]);
    }
    if (tableName === "timetables") {
      return queryResult([
        {
          ...timetable,
          timetable_versions: {
            id: "version-1",
            published_at: "2026-09-03T08:00:00.000Z",
          },
        },
      ]);
    }
    throw new Error(`Unexpected table ${tableName}`);
  });
});

describe("DR-65 truthful founder conversion analytics", () => {
  it("separates preparation, verified activation, feed observation and ICS fallback", async () => {
    const overview = await getAnalyticsOverview({
      from: "2026-09-04",
      to: "2026-09-04",
      timezone: "Africa/Harare",
    });

    expect(overview.operations.pilotPulse).toMatchObject({
      uniqueTimetableViewers: 6,
      addToCalendarStarts: 5,
      reminderSelections: 5,
      providerSelections: 5,
      providerHandoffs: 5,
      googleConnectionsCompleted: 1,
      googleConnectionFailures: 1,
      verifiedActivations: 2,
      calendarSubscriptionsCreated: 5,
      updateEnabledSubscriptions: 3,
      oneTimeIcsDownloads: 1,
      feedObservedSubscriptions: 1,
      shares: 1,
      legacyConnectionPreparationRate: 0.75,
    });
    expect(
      overview.operations.pilotPulse.verifiedActivationConversion,
    ).toBeCloseTo(2 / 6);
    expect(
      overview.conversionFunnel?.map(({ stage, people }) => [stage, people]),
    ).toEqual([
      ["timetable_viewed", 6],
      ["add_to_calendar_started", 5],
      ["reminder_selected", 5],
      ["provider_selected", 5],
      ["provider_handoff_prepared", 5],
      ["verified_activation", 2],
    ]);

    expect(overview.funnel).toEqual([{ stage: "legacy", people: 99 }]);
    expect(
      overview.kpis.find((metric) => metric.id === "calendarActivationRate")
        ?.label,
    ).toBe("Historical connection preparation rate");
    expect(
      overview.kpis.find(
        (metric) => metric.id === "verifiedCalendarActivationRate",
      )?.value,
    ).toBeCloseTo(2 / 6);

    expect(overview.operations.subscriberHealth[0]).toMatchObject({
      label: "HIT - Software Engineering - Part 1.1",
      activeSubscriptions: 4,
      updateEnabledSubscriptions: 3,
      oneTimeIcsDownloads: 1,
      contactableSubscriptions: 1,
      feedObservedSubscriptions: 1,
      providerMix: {
        apple_subscription: 2,
        google_api: 1,
        ics_download: 1,
      },
    });
    expect(JSON.stringify(overview)).not.toContain("profile-secret");
    expect(JSON.stringify(overview)).not.toContain("must-not-be-selected");
  });

  it("segments the strict funnel by privacy-safe entry path, device and provider", async () => {
    const overview = await getAnalyticsOverview({
      from: "2026-09-04",
      to: "2026-09-04",
      timezone: "Africa/Harare",
      entryPath: path,
      deviceKind: "mobile",
      provider: "apple_subscription",
    });

    expect(
      overview.conversionFunnel?.map(({ stage, people }) => [stage, people]),
    ).toEqual([
      ["timetable_viewed", 2],
      ["add_to_calendar_started", 2],
      ["reminder_selected", 2],
      ["provider_selected", 2],
      ["provider_handoff_prepared", 2],
      ["verified_activation", 1],
    ]);
    expect(overview.operations.pilotPulse.googleConnectionsCompleted).toBe(0);
    expect(overview.operations.pilotPulse.oneTimeIcsDownloads).toBe(0);
    expect(overview.operations.pilotPulse.feedObservedSubscriptions).toBe(1);
  });

  it("keeps timetable trust aggregation intact", async () => {
    const overview = await getAnalyticsOverview({
      from: "2026-09-04",
      to: "2026-09-04",
      timezone: "Africa/Harare",
    });
    expect(overview.operations.timetableTrust[0]).toMatchObject({
      unresolvedSourceReviews: 1,
      pinnedCorrections: 1,
      pendingExceptions: 1,
      hasClassRep: true,
      warnings: [
        "Source review needs attention",
        "Pinned Class Rep correction active",
        "Pending date exception active",
      ],
    });
  });
});
