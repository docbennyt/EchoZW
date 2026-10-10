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

  it("queries active and failed subscriptions as syncable, while excluding revoked rows", () => {
    const source = readFileSync("server/googleCalendarRepository.ts", "utf8");

    expect(source).toContain("listSyncableGoogleSubscriptions");
    expect(source).toContain('.in("status", ["active", "failed"])');
    expect(source).toContain('.is("revoked_at", null)');
  });
});
