import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";

const repositoryMocks = vi.hoisted(() => ({
  getCalendarSubscriptionById: vi.fn(),
  getPublishedTimetableById: vi.fn(),
}));

const revisionMocks = vi.hoisted(() => ({
  getCalendarRevision: vi.fn(),
}));

const googleRepositoryMocks = vi.hoisted(() => ({
  consumeGoogleOAuthState: vi.fn(),
  createGoogleOAuthState: vi.fn(),
  deleteGoogleCredential: vi.fn(),
  deleteGoogleEventSyncRecord: vi.fn(),
  getCurrentPublishedVersionId: vi.fn(),
  getGoogleCredential: vi.fn(),
  listGoogleEventSyncRecords: vi.fn(),
  listSyncableGoogleSubscriptions: vi.fn(),
  saveGoogleCredential: vi.fn(),
  updateGoogleSubscription: vi.fn(),
  upsertGoogleEventSyncRecord: vi.fn(),
}));

vi.mock("../server/pilotRepository", () => {
  class PilotApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      public readonly status: number,
      public readonly details?: unknown,
    ) {
      super(message);
    }
  }

  return {
    PilotApiError,
    ...repositoryMocks,
  };
});

vi.mock("../server/calendarRevisionRepository", () => revisionMocks);
vi.mock("../server/googleCalendarRepository", () => googleRepositoryMocks);

import {
  encryptGoogleRefreshToken,
  previewGoogleSubscriptionSync,
  syncGoogleSubscription,
  syncGoogleSubscriptionsForTimetable,
} from "../server/googleCalendarSync";

const env = {
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "server-client-secret",
  GOOGLE_REDIRECT_URI:
    "https://calender.aido.co.zw/api/calendar/google/callback",
  TOKEN_ENCRYPTION_KEY: "test-only-dedicated-token-encryption-secret",
  PUBLIC_APP_URL: "https://calender.aido.co.zw",
} as NodeJS.ProcessEnv;

function timetable(overrides: Partial<PublicTimetable> = {}): PublicTimetable {
  return {
    timetableId: "tt-se41",
    publicSlug: "ise-part-4-1-august-semester-2026",
    institution: "Harare Institute of Technology",
    institutionShortName: "HIT",
    institutionTimezone: "Africa/Harare",
    programme: "Software Engineering",
    classGroup: "Part 4.1",
    academicPeriod: "August Semester 2026",
    startsOn: "2026-08-10",
    endsOn: "2026-12-10",
    publishedAt: "2026-08-09T08:00:00.000Z",
    versionNumber: 1,
    sessions: [
      {
        stableSessionKey: "ise4105-tue-corrected",
        courseCode: "ISE4105",
        courseName: "Software Project Management",
        weekday: 2,
        startTime: "12:15:00",
        endTime: "13:15:00",
        venue: "N109",
        lecturer: "Ms Moyo",
        sessionType: "Lecture",
        notes: null,
      },
    ],
    ...overrides,
  };
}

function okJson(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("DR-171 existing Google Calendar subscription propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-ise4105",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-removed",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-wed-removed",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-ise4105?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-ise4105" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-removed?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `Unexpected Google API request: ${init?.method} ${value}`,
        );
      }),
    );
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValue({
      id: "sub-existing",
      provider: "google_api",
      status: "active",
      timetable_id: "tt-se41",
      calendar_name: "SE 4.1 - CalenderZW",
      timezone: "Africa/Harare",
      reminder_offsets_minutes: [30],
      external_calendar_id: "cal-existing",
      revoked_at: null,
    });
    repositoryMocks.getPublishedTimetableById.mockResolvedValue(timetable());
    revisionMocks.getCalendarRevision.mockResolvedValue({
      updatedAt: "2026-08-11T10:30:00.000Z",
      sequence: 4,
    });
    googleRepositoryMocks.getCurrentPublishedVersionId.mockResolvedValue(
      "version-current",
    );
    googleRepositoryMocks.getGoogleCredential.mockResolvedValue({
      encrypted_refresh_token: encryptGoogleRefreshToken("refresh-token", env),
    });
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-ise4105",
        content_hash: "stale-hash",
      },
      {
        internal_event_id: "ise4105-wed-removed",
        external_event_id: "event-removed",
        content_hash: "old-removed-hash",
      },
    ]);
    googleRepositoryMocks.updateGoogleSubscription.mockResolvedValue(undefined);
    googleRepositoryMocks.upsertGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
    googleRepositoryMocks.deleteGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
  });

  it("lists only verified CZW-owned remote deletion candidates during dry-run", async () => {
    const preview = await previewGoogleSubscriptionSync("sub-existing", env);

    expect(preview).toMatchObject({
      readOnly: true,
      wouldDelete: 1,
      remoteManagedDeletionCandidates: [
        {
          stableSessionKey: "ise4105-wed-removed",
          externalEventId: "event-removed",
        },
      ],
    });
    expect(
      googleRepositoryMocks.deleteGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-removed?sendUpdates=none"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("updates and deletes existing remote events by stable session key without creating a new calendar", async () => {
    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).not.toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars",
      expect.anything(),
    );
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url).includes("event-ise4105") && init?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      summary: expect.stringContaining("ISE4105"),
      location: "N109",
      extendedProperties: {
        private: {
          calenderzwStableSessionKey: "ise4105-tue-corrected",
          calenderzwTimetableId: "tt-se41",
        },
      },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("event-removed"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-tue-corrected",
        timetableVersionId: "version-current",
        externalCalendarId: "cal-existing",
        externalEventId: "event-ise4105",
        syncStatus: "active",
      }),
    );
    expect(
      googleRepositoryMocks.deleteGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-wed-removed",
      }),
    );
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        status: "active",
        externalCalendarId: "cal-existing",
        syncedTimetableVersionId: "version-current",
        lastErrorCode: null,
      }),
    );
  });

  it("keeps failed Google subscriptions in the timetable retry set", async () => {
    googleRepositoryMocks.listSyncableGoogleSubscriptions.mockResolvedValue([
      { id: "sub-failed", status: "failed" },
    ]);
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-failed",
      provider: "google_api",
      status: "failed",
      timetable_id: "tt-se41",
      calendar_name: "SE 4.1 - CalenderZW",
      timezone: "Africa/Harare",
      reminder_offsets_minutes: [30],
      external_calendar_id: "cal-existing",
      revoked_at: null,
    });

    const result = await syncGoogleSubscriptionsForTimetable("tt-se41", env);

    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(
      googleRepositoryMocks.listSyncableGoogleSubscriptions,
    ).toHaveBeenCalledWith("tt-se41", env);
  });

  it("records a temporary Google failure and later reconciles the same existing event without duplicates", async () => {
    googleRepositoryMocks.listSyncableGoogleSubscriptions.mockResolvedValue([
      { id: "sub-existing", status: "active" },
    ]);
    vi.mocked(fetch).mockImplementation(async (url: string | URL | Request) => {
      const value = String(url);
      if (value === "https://oauth2.googleapis.com/token") {
        return okJson({ access_token: "access-token" });
      }
      return okJson({ error: { code: 503 } }, 503);
    });

    const failed = await syncGoogleSubscriptionsForTimetable("tt-se41", env);

    expect(failed).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        status: "failed",
        lastErrorCode: "GOOGLE_API_FAILED",
      }),
    );

    vi.mocked(fetch).mockClear();
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-ise4105",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-removed",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-wed-removed",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-ise4105?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-ise4105" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-removed?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `Unexpected Google API request during retry: ${init?.method} ${value}`,
        );
      },
    );
    googleRepositoryMocks.updateGoogleSubscription.mockClear();

    const retried = await syncGoogleSubscriptionsForTimetable("tt-se41", env);

    expect(retried).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(fetch).not.toHaveBeenCalledWith(
      "https://www.googleapis.com/calendar/v3/calendars",
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events/event-ise4105?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events/event-removed?sendUpdates=none"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledTimes(1);
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        status: "active",
        lastErrorCode: null,
      }),
    );
  });

  it("deletes orphaned CalenderZW-managed Google events even when the local sync row is missing", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-ise4105",
        content_hash: "stale-hash",
      },
    ]);
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-ise4105",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-orphaned-wednesday",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-wed-removed",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-ise4105?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-ise4105" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-orphaned-wednesday?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `Unexpected Google API request while deleting orphan: ${init?.method} ${value}`,
        );
      },
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
      ),
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/events/event-orphaned-wednesday?sendUpdates=none",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      googleRepositoryMocks.deleteGoogleEventSyncRecord,
    ).not.toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-wed-removed",
      }),
    );
  });

  it("adopts existing CalenderZW-managed Google events when mappings are missing instead of creating duplicates", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([]);
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-existing-tuesday",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-orphaned-wednesday",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-wed-removed",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-duplicate-tuesday",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-existing-tuesday?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-existing-tuesday" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-orphaned-wednesday?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-duplicate-tuesday?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `Unexpected Google API request while adopting managed event: ${init?.method} ${value}`,
        );
      },
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 2,
      unchanged: 0,
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "/calendars/cal-existing/events?sendUpdates=none",
      ),
      expect.objectContaining({ method: "POST" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-tue-corrected",
        externalEventId: "event-existing-tuesday",
        syncStatus: "active",
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/events/event-duplicate-tuesday?sendUpdates=none",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("recreates a missing remote event even when the local content hash is unchanged", async () => {
    await syncGoogleSubscription("sub-existing", env);
    const currentHashCall =
      googleRepositoryMocks.upsertGoogleEventSyncRecord.mock.calls.find(
        ([input]) => input.internalEventId === "ise4105-tue-corrected",
      );
    const currentHash = currentHashCall?.[0]?.contentHash;
    expect(currentHash).toEqual(expect.any(String));

    vi.clearAllMocks();
    googleRepositoryMocks.getCurrentPublishedVersionId.mockResolvedValue(
      "version-current",
    );
    googleRepositoryMocks.getGoogleCredential.mockResolvedValue({
      encrypted_refresh_token: encryptGoogleRefreshToken("refresh-token", env),
    });
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-missing",
        content_hash: currentHash,
      },
    ]);
    googleRepositoryMocks.updateGoogleSubscription.mockResolvedValue(undefined);
    googleRepositoryMocks.upsertGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
    googleRepositoryMocks.deleteGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({ items: [] });
        }
        if (
          value.includes("/calendars/cal-existing/events?sendUpdates=none") &&
          init?.method === "POST"
        ) {
          return okJson({ id: "event-recreated" });
        }
        throw new Error(
          `Unexpected Google API request while recreating missing remote event: ${init?.method} ${value}`,
        );
      }),
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 1,
      updated: 0,
      deleted: 0,
      unchanged: 0,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        "/calendars/cal-existing/events?sendUpdates=none",
      ),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-missing?sendUpdates=none"),
      expect.anything(),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-tue-corrected",
        externalEventId: "event-recreated",
        contentHash: currentHash,
      }),
    );
  });

  it("adopts a remotely managed event when the local mapping points to a stale event id", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-stale",
        content_hash: "stale-hash",
      },
    ]);
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-current",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-current?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-current" });
        }
        throw new Error(
          `Unexpected Google API request while adopting current remote event: ${init?.method} ${value}`,
        );
      },
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 0,
      unchanged: 0,
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-stale?sendUpdates=none"),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events/event-current?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-tue-corrected",
        externalEventId: "event-current",
        syncStatus: "active",
      }),
    );
  });

  it("never overwrites an event with a different CZW stable key when the local mapping points to it", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-other-session",
        content_hash: "stale-hash",
      },
    ]);
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-other-session",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-wed-removed",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "event-tuesday",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-tuesday?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-tuesday" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-other-session?sendUpdates=none",
          ) &&
          init?.method === "DELETE"
        ) {
          return new Response(null, { status: 204 });
        }
        throw new Error(
          `Unexpected Google API request for stable-key mapping regression: ${init?.method} ${value}`,
        );
      },
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-other-session?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/events/event-tuesday?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        internalEventId: "ise4105-tue-corrected",
        externalEventId: "event-tuesday",
      }),
    );
  });

  it("does not delete historical Google events without CalenderZW private ownership markers", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-ise4105",
        content_hash: "stale-hash",
      },
    ]);
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events?privateExtendedProperty=calenderzwTimetableId%3Dtt-se41",
          ) &&
          init?.method === "GET"
        ) {
          return okJson({
            items: [
              {
                id: "event-ise4105",
                extendedProperties: {
                  private: {
                    calenderzwStableSessionKey: "ise4105-tue-corrected",
                    calenderzwTimetableId: "tt-se41",
                  },
                },
              },
              {
                id: "historical-untagged-wednesday",
                summary: "ISE4105 Software Testing & Quality Assurance",
                extendedProperties: { private: {} },
              },
            ],
          });
        }
        if (
          value.includes(
            "/calendars/cal-existing/events/event-ise4105?sendUpdates=none",
          ) &&
          init?.method === "PUT"
        ) {
          return okJson({ id: "event-ise4105" });
        }
        throw new Error(
          `Unexpected Google API request while preserving untagged event: ${init?.method} ${value}`,
        );
      },
    );

    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 0,
      unchanged: 0,
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining(
        "/events/historical-untagged-wednesday?sendUpdates=none",
      ),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("queries active and failed subscriptions as syncable, while excluding revoked rows", () => {
    const source = readFileSync("server/googleCalendarRepository.ts", "utf8");

    expect(source).toContain("listSyncableGoogleSubscriptions");
    expect(source).toContain('.in("status", ["active", "failed"])');
    expect(source).toContain('.is("revoked_at", null)');
  });
});
