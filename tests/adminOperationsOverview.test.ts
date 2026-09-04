import { describe, expect, it, vi } from "vitest";

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

describe("admin operations overview aggregates", () => {
  it("computes subscriber health and trust without exposing private identifiers", async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        active_calendar_connections: 2,
        unique_timetable_viewers: 8,
        calendar_activation_rate: 0.25,
        new_calendar_connections: 2,
        feed_health_rate: 0.5,
        provider_mix: [],
        adoption_timeseries: [],
        funnel: [],
        events_received: 4,
      },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "analytics_events") {
        return queryResult([
          { event_name: "calendar_cta_clicked", created_at: "2026-09-04" },
          { event_name: "onboarding_completed", created_at: "2026-09-04" },
          { event_name: "timetable_shared", created_at: "2026-09-04" },
        ]);
      }
      if (table === "calendar_subscriptions") {
        return queryResult([
          {
            id: "sub-1",
            timetable_id: "tt-1",
            provider: "apple_subscription",
            status: "active",
            subscriber_profile_id: "profile-secret",
            last_feed_fetch_at: "2026-09-04T08:00:00.000Z",
            token_hash: "must-not-be-selected",
            timetables: {
              id: "tt-1",
              public_slug: "hit-se-1",
              institutions: { short_name: "HIT", name: "HIT" },
              programmes: { name: "Software Engineering" },
              cohorts: { label: "Part 1.1" },
            },
          },
          {
            id: "sub-2",
            timetable_id: "tt-1",
            provider: "ics_download",
            status: "active",
            subscriber_profile_id: null,
            last_feed_fetch_at: null,
            timetables: {
              id: "tt-1",
              public_slug: "hit-se-1",
              institutions: { short_name: "HIT", name: "HIT" },
              programmes: { name: "Software Engineering" },
              cohorts: { label: "Part 1.1" },
            },
          },
        ]);
      }
      if (table === "timetable_correction_directives") {
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
      if (table === "timetable_session_exceptions") {
        return queryResult([
          { id: "exception-1", timetable_id: "tt-1", active: true },
        ]);
      }
      if (table === "staff_users") {
        return queryResult([
          { id: "staff-1", role: "class_rep", active: true },
        ]);
      }
      if (table === "class_rep_assignments") {
        return queryResult([
          {
            id: "assignment-1",
            timetable_id: "tt-1",
            staff_user_id: "staff-1",
            active: true,
          },
        ]);
      }
      if (table === "timetable_source_reviews") {
        return queryResult([
          { id: "review-1", timetable_id: "tt-1", status: "pending" },
        ]);
      }
      if (table === "timetables") {
        return queryResult([
          {
            id: "tt-1",
            public_slug: "hit-se-1",
            current_published_version_id: "version-1",
            timetable_versions: {
              id: "version-1",
              published_at: "2026-09-03T08:00:00.000Z",
            },
            institutions: { short_name: "HIT", name: "HIT" },
            programmes: { name: "Software Engineering" },
            cohorts: { label: "Part 1.1" },
          },
        ]);
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const overview = await getAnalyticsOverview({
      from: "2026-09-04",
      to: "2026-09-04",
      timezone: "Africa/Harare",
    });

    expect(overview.operations.pilotPulse).toMatchObject({
      uniqueTimetableViewers: 8,
      onboardingStarts: 1,
      onboardingCompletions: 1,
      calendarSubscriptionsCreated: 2,
      updateEnabledSubscriptions: 1,
      oneTimeIcsDownloads: 1,
      feedObservedSubscriptions: 1,
      shares: 1,
      activationConversion: 0.25,
    });
    expect(overview.operations.subscriberHealth[0]).toMatchObject({
      label: "HIT - Software Engineering - Part 1.1",
      activeSubscriptions: 2,
      updateEnabledSubscriptions: 1,
      oneTimeIcsDownloads: 1,
      contactableSubscriptions: 1,
      feedObservedSubscriptions: 1,
      providerMix: {
        apple_subscription: 1,
        ics_download: 1,
      },
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
    expect(JSON.stringify(overview)).not.toContain("profile-secret");
    expect(JSON.stringify(overview)).not.toContain("must-not-be-selected");
  });
});
