import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
  persistGoogleCalendarConnection: vi.fn(),
  disconnectGoogleCalendarConnection: vi.fn(),
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
  beginGoogleCalendarConnection,
  completeGoogleCalendarConnection,
  disconnectGoogleCalendar,
  previewGoogleSubscriptionSync,
  syncGoogleSubscription,
  syncGoogleSubscriptionsForTimetable,
} from "../server/googleCalendarSync";
import { deliverGoogleCalendarJob } from "../server/googleCalendarDelivery";
import { budgetedFetch } from "../server/externalRequestBudget";

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

const ownedFixtureKeys: Record<string, string> = {
  "event-ise4105": "ise4105-tue-corrected",
  "event-removed": "ise4105-wed-removed",
  "event-orphaned-wednesday": "ise4105-wed-removed",
  "event-existing-tuesday": "ise4105-tue-corrected",
  "event-duplicate-tuesday": "ise4105-tue-corrected",
  "event-current": "ise4105-tue-corrected",
  "event-other-session": "ise4105-wed-removed",
  "event-tuesday": "ise4105-tue-corrected",
};

function ownershipFixture(url: string, init?: RequestInit) {
  if (init?.method !== "GET") return null;
  const id = url.match(/\/calendars\/cal-existing\/events\/([^/?]+)$/)?.[1];
  if (!id) return null;
  if (id === "event-missing" || id === "event-stale") {
    return okJson({}, id === "event-missing" ? 404 : 410);
  }
  const stableKey = ownedFixtureKeys[id];
  if (!stableKey) throw new Error(`Missing ownership fixture for ${id}`);
  return okJson({
    id,
    extendedProperties: {
      private: {
        calenderzwTimetableId: "tt-se41",
        calenderzwStableSessionKey: stableKey,
      },
    },
  });
}

describe("DR-171 existing Google Calendar subscription propagation", () => {
  it("allows only the selected canary callback and its matching OAuth-state owner", async () => {
    const id = "33333333-3333-4333-8333-333333333333";
    const owner = "11111111-1111-4111-8111-111111111111";
    const timetableId = "22222222-2222-4222-8222-222222222222";
    const bindings = {
      ...env,
      ENABLE_GOOGLE_DELIVERY: "false",
      APP_ENV: "cloudflare-staging",
      GOOGLE_CANARY_SUBSCRIPTION_ID: id,
      GOOGLE_CANARY_OWNER_ID: owner,
      GOOGLE_CANARY_TIMETABLE_ID: timetableId,
      GOOGLE_CANARY_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
    };
    const row = {
      id,
      anonymous_session_id: owner,
      timetable_id: timetableId,
      provider: "google_api",
      status: "pending",
    };
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: id,
      anonymous_session_id: "other",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce(row);
    await expect(
      completeGoogleCalendarConnection({
        code: "code",
        state: "state",
        env: bindings,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_STATE_INVALID" });
    expect(fetch).not.toHaveBeenCalled();
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: id,
      anonymous_session_id: owner,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce(row);
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({ access_token: "access", refresh_token: "refresh" }),
    );
    const enqueueInitialSync = vi.fn().mockResolvedValue(undefined);
    expect(
      await completeGoogleCalendarConnection({
        code: "code",
        state: "state",
        env: bindings,
        enqueueInitialSync,
      }),
    ).toMatchObject({ subscriptionId: id });
    expect(enqueueInitialSync).toHaveBeenCalledWith(
      { subscriptionId: id, timetableId },
      bindings,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not mark student connections failed when broad sync is invoked during the isolated test", async () => {
    googleRepositoryMocks.listSyncableGoogleSubscriptions.mockResolvedValueOnce(
      [{ id: "student", provider: "google_api", timetable_id: "tt-se41" }],
    );
    expect(
      await syncGoogleSubscriptionsForTimetable("tt-se41", {
        ...env,
        APP_ENV: "cloudflare-staging",
        ENABLE_GOOGLE_DELIVERY: "false",
      }),
    ).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).not.toHaveBeenCalled();
  });
  it("rejects an unrelated staging callback before exchanging code or persisting credentials", async () => {
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: "sub-existing",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    await expect(
      completeGoogleCalendarConnection({
        code: "code",
        state: "state",
        env: {
          ...env,
          APP_ENV: "cloudflare-staging",
          ENABLE_GOOGLE_DELIVERY: "false",
        },
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_DELIVERY_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.persistGoogleCalendarConnection,
    ).not.toHaveBeenCalled();
  });
  it("rejects direct staging sync outside the selected canary before provider requests", async () => {
    await expect(
      syncGoogleSubscription("sub-existing", {
        ...env,
        APP_ENV: "cloudflare-staging",
        ENABLE_GOOGLE_DELIVERY: "false",
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_DELIVERY_UNAVAILABLE" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("passes explicit bindings into the connection subscription lookup", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      anonymous_session_id: "owner",
    });
    await beginGoogleCalendarConnection({
      subscriptionId: "sub-existing",
      anonymousSessionId: "owner",
      env,
    });
    expect(repositoryMocks.getCalendarSubscriptionById).toHaveBeenCalledWith(
      "sub-existing",
      env,
    );
  });

  it("rejects a revoked callback before token exchange or credential persistence", async () => {
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: "sub-existing",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      revoked_at: "2026-10-01",
    });
    await expect(
      completeGoogleCalendarConnection({ code: "code", state: "state", env }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_REVOKED" });
    expect(fetch).not.toHaveBeenCalled();
    expect(googleRepositoryMocks.saveGoogleCredential).not.toHaveBeenCalled();
  });

  it("queues initial sync after storing compatible credentials without writing provider events", async () => {
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: "sub-existing",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      timetable_id: "tt-se41",
      status: "pending",
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "access",
          refresh_token: "refresh",
          scope: "https://www.googleapis.com/auth/calendar.app.created",
        }),
      ),
    );
    const enqueueInitialSync = vi.fn().mockResolvedValue(undefined);
    await completeGoogleCalendarConnection({
      code: "code",
      state: "state",
      env,
      enqueueInitialSync,
    });
    expect(
      googleRepositoryMocks.persistGoogleCalendarConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "sub-existing",
        connectionGeneration: 0,
        encryptedRefreshToken: expect.stringMatching(/^v1\./),
        env,
      }),
    );
    expect(
      googleRepositoryMocks.persistGoogleCalendarConnection.mock
        .invocationCallOrder[0],
    ).toBeLessThan(enqueueInitialSync.mock.invocationCallOrder[0]);
    expect(enqueueInitialSync).toHaveBeenCalledWith(
      { subscriptionId: "sub-existing", timetableId: "tt-se41" },
      env,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.getPublishedTimetableById).toHaveBeenCalledWith(
      "tt-se41",
      env,
    );
  });

  it("does not report connection success when initial enqueue fails", async () => {
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: "sub-existing",
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    vi.mocked(fetch).mockResolvedValueOnce(
      okJson({ access_token: "access", refresh_token: "refresh" }),
    );
    const enqueueInitialSync = vi
      .fn()
      .mockRejectedValue(new Error("queue unavailable"));
    await expect(
      completeGoogleCalendarConnection({
        code: "code",
        state: "state",
        env,
        enqueueInitialSync,
      }),
    ).rejects.toThrow("queue unavailable");
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith({
      subscriptionId: "sub-existing",
      status: "failed",
      lastErrorCode: "GOOGLE_SYNC_FAILED",
      connectionGeneration: 0,
      env,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a callback whose token exchange overlaps disconnect before atomic persistence", async () => {
    googleRepositoryMocks.consumeGoogleOAuthState.mockResolvedValueOnce({
      subscription_id: "sub-existing",
      connection_generation: 7,
      expires_at: new Date(Date.now() + 60000).toISOString(),
    });
    let release!: () => void;
    let started!: () => void;
    const exchanging = new Promise<void>((resolve) => {
      started = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(fetch).mockImplementationOnce(async () => {
      started();
      await blocked;
      return okJson({ access_token: "access", refresh_token: "refresh" });
    });
    const enqueueInitialSync = vi.fn();
    const callback = completeGoogleCalendarConnection({
      code: "code",
      state: "state",
      env,
      enqueueInitialSync,
    });
    await exchanging;
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      anonymous_session_id: "owner",
    });
    await disconnectGoogleCalendar({
      subscriptionId: "sub-existing",
      anonymousSessionId: "owner",
      deleteCreatedCalendar: false,
      env,
    });
    googleRepositoryMocks.persistGoogleCalendarConnection.mockRejectedValueOnce(
      Object.assign(new Error("Connection changed"), {
        code: "SUBSCRIPTION_DISCONNECTED",
      }),
    );
    release();
    await expect(callback).rejects.toMatchObject({
      code: "SUBSCRIPTION_DISCONNECTED",
    });
    expect(
      googleRepositoryMocks.persistGoogleCalendarConnection,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ connectionGeneration: 7 }),
    );
    expect(enqueueInitialSync).not.toHaveBeenCalled();
    expect(googleRepositoryMocks.saveGoogleCredential).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).not.toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
  });

  it("bounds every provider request and prevents redirects carrying Authorization", async () => {
    await syncGoogleSubscription("sub-existing", env);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(init?.redirect).toBe("manual");
      expect(init?.signal).toBeDefined();
      expect(String(url)).not.toMatch(
        /access-token|refresh-token|server-client-secret/,
      );
    }
  });

  it("rejects final persistence after disconnect/reconnect without reporting sync completion", async () => {
    let release!: () => void;
    let ready!: () => void;
    const paused = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const resumed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const state = { status: "active", generation: 0, calendar: "cal-existing" };
    googleRepositoryMocks.updateGoogleSubscription.mockImplementation(
      async (input) => {
        expect(input.connectionGeneration).toBe(0);
        if (input.lastSyncedAt) {
          ready();
          await resumed;
        }
        if (
          state.generation !== input.connectionGeneration ||
          state.status === "disconnected"
        )
          return false;
        if (input.status) state.status = input.status;
        return true;
      },
    );
    const sync = syncGoogleSubscription("sub-existing", env);
    await paused;
    state.status = "pending";
    state.generation = 1;
    state.calendar = "new-calendar";
    const writesBeforeRelease = vi.mocked(fetch).mock.calls.length;
    release();
    await expect(sync).rejects.toMatchObject({
      code: "GOOGLE_CONNECTION_CHANGED",
    });
    expect(state).toEqual({
      status: "pending",
      generation: 1,
      calendar: "new-calendar",
    });
    expect(fetch).toHaveBeenCalledTimes(writesBeforeRelease);
  });

  it("stops after a rejected created-calendar persistence guard before event reads or writes", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      timetable_id: "tt-se41",
      status: "pending",
      google_connection_generation: 4,
    });
    const baseFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url).endsWith("/calendars") && init?.method === "POST")
        return okJson({ id: "old-created-calendar" });
      return baseFetch(url, init);
    });
    googleRepositoryMocks.updateGoogleSubscription.mockImplementation(
      async (input) => !input.externalCalendarId,
    );
    await expect(
      syncGoogleSubscription("sub-existing", env),
    ).rejects.toMatchObject({ code: "GOOGLE_CONNECTION_CHANGED" });
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionGeneration: 4,
        externalCalendarId: "old-created-calendar",
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
  });

  it("stops on a rejected mapping guard before further provider writes", async () => {
    googleRepositoryMocks.upsertGoogleEventSyncRecord.mockRejectedValueOnce(
      Object.assign(new Error("Generation changed"), {
        code: "GOOGLE_CONNECTION_CHANGED",
      }),
    );
    await expect(
      syncGoogleSubscription("sub-existing", env),
    ).rejects.toMatchObject({ code: "GOOGLE_CONNECTION_CHANGED" });
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ connectionGeneration: 0 }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).not.toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
  });

  it("fences the timetable-level failed-state handler after a lifecycle change", async () => {
    googleRepositoryMocks.listSyncableGoogleSubscriptions.mockResolvedValue([
      { id: "sub-existing", google_connection_generation: 0 },
    ]);
    googleRepositoryMocks.updateGoogleSubscription.mockResolvedValue(false);
    expect(
      await syncGoogleSubscriptionsForTimetable("tt-se41", env),
    ).toMatchObject({ failed: 1 });
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        connectionGeneration: 0,
        status: "failed",
        lastErrorCode: "GOOGLE_CONNECTION_CHANGED",
      }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it.each(["refresh", "delete"])(
    "fails closed on calendar cleanup before any provider %s or local detach",
    async (failure) => {
      repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
        id: "sub-existing",
        provider: "google_api",
        anonymous_session_id: "owner",
      });
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (String(url) === "https://oauth2.googleapis.com/token")
          return failure === "refresh"
            ? okJson({ error: "invalid_grant" }, 400)
            : okJson({ access_token: "access" });
        if (init?.method === "DELETE")
          return okJson({ error: { code: 503 } }, 503);
        return okJson({});
      });
      await expect(
        disconnectGoogleCalendar({
          subscriptionId: "sub-existing",
          anonymousSessionId: "owner",
          deleteCreatedCalendar: true,
          env,
        }),
      ).rejects.toMatchObject({
        code: "GOOGLE_CALENDAR_CLEANUP_UNAVAILABLE",
        status: 503,
      });
      expect(
        googleRepositoryMocks.disconnectGoogleCalendarConnection,
      ).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.updateGoogleSubscription,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({ externalCalendarId: null }),
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("reports confirmed revocation without claiming calendar deletion", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      anonymous_session_id: "owner",
    });
    googleRepositoryMocks.disconnectGoogleCalendarConnection.mockResolvedValueOnce(
      {
        encrypted_refresh_token: encryptGoogleRefreshToken(
          "refresh-token",
          env,
        ),
        external_calendar_id: "cal-existing",
        connection_generation: 8,
      },
    );
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (String(url) === "https://oauth2.googleapis.com/token")
        return okJson({ access_token: "access" });
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      return okJson({});
    });
    expect(
      await disconnectGoogleCalendar({
        subscriptionId: "sub-existing",
        anonymousSessionId: "owner",
        deleteCreatedCalendar: false,
        env,
      }),
    ).toEqual({
      ok: true,
      deletedCreatedCalendar: false,
      providerRevocation: "confirmed",
    });
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).not.toHaveBeenCalled();
  });

  it.each(["decrypt", "http", "network"])(
    "reports successful local disconnect with unverified provider revocation on %s failure",
    async (failure) => {
      repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
        id: "sub-existing",
        provider: "google_api",
        anonymous_session_id: "owner",
      });
      if (failure === "decrypt")
        googleRepositoryMocks.disconnectGoogleCalendarConnection.mockResolvedValueOnce(
          { encrypted_refresh_token: "invalid-ciphertext" },
        );
      vi.mocked(fetch).mockImplementation(async () => {
        if (failure === "network") throw new Error("private-provider-error");
        return okJson({}, 503);
      });
      expect(
        await disconnectGoogleCalendar({
          subscriptionId: "sub-existing",
          anonymousSessionId: "owner",
          deleteCreatedCalendar: false,
          env,
        }),
      ).toEqual({
        ok: true,
        deletedCreatedCalendar: false,
        providerRevocation: "unverified",
      });
      expect(
        googleRepositoryMocks.disconnectGoogleCalendarConnection,
      ).toHaveBeenCalledTimes(1);
      if (failure === "decrypt") expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("propagates delivery lease abort to refresh and stops all event writes", async () => {
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      observedSignal = init?.signal ?? undefined;
      controller.abort();
      return okJson({ access_token: "access-token" });
    });
    await expect(
      syncGoogleSubscription("sub-existing", env, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED" });
    expect(observedSignal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
  });

  it("propagates lease abort to event requests and never marks a partial sync active", async () => {
    const controller = new AbortController();
    const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const result = await defaultFetch(url, init);
      if (init?.method === "PUT") controller.abort();
      return result;
    });
    await expect(
      syncGoogleSubscription("sub-existing", env, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED" });
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).not.toHaveBeenCalledWith(expect.objectContaining({ status: "active" }));
  });

  it("revokes using a bounded POST form without credentials in the URL", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "sub-existing",
      provider: "google_api",
      anonymous_session_id: "owner",
    });
    vi.mocked(fetch).mockResolvedValueOnce(okJson({}));
    await disconnectGoogleCalendar({
      subscriptionId: "sub-existing",
      anonymousSessionId: "owner",
      deleteCreatedCalendar: false,
      env,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://oauth2.googleapis.com/revoke",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        signal: expect.anything(),
        body: expect.any(URLSearchParams),
      }),
    );
    const body = vi.mocked(fetch).mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get("token")).toBe("refresh-token");
    expect(repositoryMocks.getCalendarSubscriptionById).toHaveBeenCalledWith(
      "sub-existing",
      env,
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    googleRepositoryMocks.updateGoogleSubscription
      .mockReset()
      .mockResolvedValue(true);
    googleRepositoryMocks.persistGoogleCalendarConnection
      .mockReset()
      .mockResolvedValue(undefined);
    googleRepositoryMocks.disconnectGoogleCalendarConnection
      .mockReset()
      .mockResolvedValue({
        encrypted_refresh_token: encryptGoogleRefreshToken(
          "refresh-token",
          env,
        ),
        external_calendar_id: "cal-existing",
      });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const value = String(url);
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
      publishedVersionId: "version-current",
    });
    googleRepositoryMocks.getCurrentPublishedVersionId.mockRejectedValue(
      new Error("Published version must come from the accepted snapshot"),
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
    googleRepositoryMocks.updateGoogleSubscription.mockResolvedValue(true);
    googleRepositoryMocks.upsertGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
    googleRepositoryMocks.deleteGoogleEventSyncRecord.mockResolvedValue(
      undefined,
    );
  });

  it("retries a correction change during the published read before any provider request and uses the accepted snapshot version", async () => {
    const before = {
      sequence: 4,
      updatedAt: "2026-08-11T10:30:00.000Z",
      publishedVersionId: "version-current",
    };
    const after = {
      sequence: 5,
      updatedAt: "2026-08-11T10:30:01.000Z",
      publishedVersionId: "version-snapshot",
    };
    let clock = before;
    const original = timetable();
    const rawBefore = JSON.stringify(original.sessions);
    const corrected = timetable({
      corrections: [
        {
          ...original.sessions[0],
          id: "correction-during-read",
          action: "modify",
          sourceMayReplace: false,
          pinned: true,
          active: true,
          reason: "Snapshot race fixture",
          provenance: null,
          createdAt: after.updatedAt,
          startTime: "13:15:00",
          endTime: "14:15:00",
          venue: "N205",
        },
      ],
    });
    revisionMocks.getCalendarRevision.mockImplementation(async () => clock);
    repositoryMocks.getPublishedTimetableById
      .mockImplementationOnce(async () => {
        expect(fetch).not.toHaveBeenCalled();
        clock = after;
        return original;
      })
      .mockImplementationOnce(async () => {
        expect(fetch).not.toHaveBeenCalled();
        expect(
          googleRepositoryMocks.getGoogleCredential,
        ).not.toHaveBeenCalled();
        expect(
          googleRepositoryMocks.upsertGoogleEventSyncRecord,
        ).not.toHaveBeenCalled();
        clock = after;
        return corrected;
      });
    googleRepositoryMocks.getCurrentPublishedVersionId.mockResolvedValue(
      "version-after-snapshot",
    );

    expect(await syncGoogleSubscription("sub-existing", env)).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(repositoryMocks.getPublishedTimetableById).toHaveBeenCalledTimes(2);
    expect(repositoryMocks.getPublishedTimetableById.mock.calls).toEqual([
      ["tt-se41", env],
      ["tt-se41", env],
    ]);
    expect(revisionMocks.getCalendarRevision).toHaveBeenCalledTimes(4);
    expect(revisionMocks.getCalendarRevision.mock.calls).toEqual(
      Array.from({ length: 4 }, () => ["tt-se41", env]),
    );
    const readOrder = [
      revisionMocks.getCalendarRevision.mock.invocationCallOrder[0],
      repositoryMocks.getPublishedTimetableById.mock.invocationCallOrder[0],
      revisionMocks.getCalendarRevision.mock.invocationCallOrder[1],
      revisionMocks.getCalendarRevision.mock.invocationCallOrder[2],
      repositoryMocks.getPublishedTimetableById.mock.invocationCallOrder[1],
      revisionMocks.getCalendarRevision.mock.invocationCallOrder[3],
    ];
    expect([...readOrder].sort((left, right) => left - right)).toEqual(
      readOrder,
    );
    expect(
      revisionMocks.getCalendarRevision.mock.invocationCallOrder[3],
    ).toBeLessThan(vi.mocked(fetch).mock.invocationCallOrder[0]);
    const writes = vi
      .mocked(fetch)
      .mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(writes).toHaveLength(1);
    expect(String(writes[0][0])).toContain(
      "/events/event-ise4105?sendUpdates=none",
    );
    expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({
      location: "N205",
      start: { dateTime: "2026-08-11T11:15:00.000Z" },
      end: { dateTime: "2026-08-11T12:15:00.000Z" },
      extendedProperties: {
        private: {
          calenderzwStableSessionKey: "ise4105-tue-corrected",
          calenderzwTimetableId: "tt-se41",
        },
      },
    });
    expect(
      googleRepositoryMocks.getCurrentPublishedVersionId,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        internalEventId: "ise4105-tue-corrected",
        externalEventId: "event-ise4105",
        timetableVersionId: after.publishedVersionId,
      }),
    );
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        syncedTimetableVersionId: after.publishedVersionId,
      }),
    );
    expect(
      googleRepositoryMocks.deleteGoogleEventSyncRecord,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ internalEventId: "ise4105-wed-removed" }),
    );
    expect(JSON.stringify(original.sessions)).toBe(rawBefore);
    expect(JSON.stringify(corrected.sessions)).toBe(rawBefore);
  });

  it("rejects continuous snapshot churn after two attempts before token, provider or mapping work in sync and preview", async () => {
    let sequence = 4;
    revisionMocks.getCalendarRevision.mockImplementation(async () => ({
      sequence: sequence++,
      updatedAt: "2026-08-11T10:30:00.000Z",
      publishedVersionId: "version-current",
    }));

    for (const [index, operation] of [
      syncGoogleSubscription,
      previewGoogleSubscriptionSync,
    ].entries()) {
      await expect(operation("sub-existing", env)).rejects.toMatchObject({
        code: "CALENDAR_REVISION_UNSTABLE",
        status: 503,
      });
      expect(repositoryMocks.getPublishedTimetableById).toHaveBeenCalledTimes(
        2 * (index + 1),
      );
      expect(revisionMocks.getCalendarRevision).toHaveBeenCalledTimes(
        4 * (index + 1),
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(googleRepositoryMocks.getGoogleCredential).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.getCurrentPublishedVersionId,
      ).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.listGoogleEventSyncRecords,
      ).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.upsertGoogleEventSyncRecord,
      ).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.deleteGoogleEventSyncRecord,
      ).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.updateGoogleSubscription,
      ).not.toHaveBeenCalled();
      expect(googleRepositoryMocks.saveGoogleCredential).not.toHaveBeenCalled();
      expect(
        googleRepositoryMocks.persistGoogleCalendarConnection,
      ).not.toHaveBeenCalled();
    }
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

  it("rejects a provider redirect without forwarding credentials or attempting mutations", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        okJson({ access_token: "test-access", expires_in: 3600 }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://unrelated.test" },
        }),
      );
    await expect(
      syncGoogleSubscription("sub-existing", env),
    ).rejects.toMatchObject({ code: "GOOGLE_REQUEST_FAILED" });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([url]) => !String(url).startsWith("https://unrelated.test"),
        ),
    ).toBe(true);
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
  });

  it("preserves conflicting mappings even when their shared remote ID is absent from LIST", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([
      {
        internal_event_id: "ise4105-tue-corrected",
        external_event_id: "event-ise4105",
        content_hash: "stale",
      },
      {
        internal_event_id: "conflicting-key",
        external_event_id: "event-ise4105",
        content_hash: "stale",
      },
    ]);
    const base = vi.mocked(fetch).getMockImplementation()!;
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      if (
        init?.method === "GET" &&
        new URL(String(url)).pathname.endsWith("/events")
      )
        return okJson({ items: [] });
      return base(url, init);
    });
    const result = await syncGoogleSubscription("sub-existing", env, {
      maxExternalRequests: 40,
    });
    expect(result).toMatchObject({
      created: 0,
      updated: 0,
      deleted: 0,
      ownershipReviewCount: 1,
    });
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.deleteGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
    expect(
      googleRepositoryMocks.updateGoogleSubscription,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        status: "failed",
        lastErrorCode: "GOOGLE_EVENT_OWNERSHIP_REVIEW",
      }),
    );
  });

  it.each(["create", "update", "crash", "delete", "delete-retry", "revoked"])(
    "bounds all provider and repository requests across durable %s continuations",
    async (scenario) => {
      type Row = Record<string, unknown>;
      const source = timetable({
        sessions: Array.from({ length: 15 }, (_, i) => ({
          ...timetable().sessions[0],
          stableSessionKey: `session-${i}`,
          courseCode: `ABC${i}`,
        })),
      });
      const rawBefore = JSON.stringify(source);
      repositoryMocks.getPublishedTimetableById.mockResolvedValue(source);
      const remote = new Map<string, Row>();
      const mappings = new Map<string, Row>();
      const owned = (id: string, key: string): Row => ({
        id,
        extendedProperties: {
          private: {
            calenderzwTimetableId: "tt-se41",
            calenderzwStableSessionKey: key,
          },
        },
      });
      const unrelated = { id: "personal", summary: "Unrelated private event" };
      remote.set("personal", unrelated);
      if (scenario === "update" || scenario.startsWith("delete")) {
        source.sessions.forEach((s, i) => {
          remote.set(`old-${i}`, owned(`old-${i}`, s.stableSessionKey));
          mappings.set(s.stableSessionKey, {
            internal_event_id: s.stableSessionKey,
            external_event_id: `old-${i}`,
            content_hash: "stale",
          });
        });
      }
      if (scenario.startsWith("delete")) {
        remote.set("obsolete", owned("obsolete", "removed-wednesday"));
        mappings.set("removed-wednesday", {
          internal_event_id: "removed-wednesday",
          external_event_id: "obsolete",
          content_hash: "old",
        });
      }
      let invocationRequests = 0;
      let duplicateCreates = 0;
      let crashed = false;
      let deleteFailed = false;
      const counts: number[] = [];
      const database = async (count = 1) => {
        for (let i = 0; i < count; i++)
          await budgetedFetch("https://database.test/rest");
      };
      for (const [mock, count] of [
        [repositoryMocks.getCalendarSubscriptionById, 1],
        [repositoryMocks.getPublishedTimetableById, 6],
        [revisionMocks.getCalendarRevision, 4],
        [googleRepositoryMocks.getCurrentPublishedVersionId, 1],
        [googleRepositoryMocks.getGoogleCredential, 1],
        [googleRepositoryMocks.updateGoogleSubscription, 1],
      ] as const) {
        const original = mock.getMockImplementation()!;
        mock.mockImplementation(async (...args) => {
          await database(count);
          return original(...args);
        });
      }
      googleRepositoryMocks.listGoogleEventSyncRecords.mockImplementation(
        async () => {
          await database();
          return [...mappings.values()];
        },
      );
      googleRepositoryMocks.upsertGoogleEventSyncRecord.mockImplementation(
        async (input) => {
          await database();
          if (scenario === "crash" && !crashed) {
            crashed = true;
            throw new Error("process failed after provider write");
          }
          mappings.set(input.internalEventId, {
            internal_event_id: input.internalEventId,
            external_event_id: input.externalEventId,
            content_hash: input.contentHash,
          });
        },
      );
      googleRepositoryMocks.deleteGoogleEventSyncRecord.mockImplementation(
        async (input) => {
          await database();
          mappings.delete(input.internalEventId);
        },
      );
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        invocationRequests++;
        expect(invocationRequests).toBeLessThanOrEqual(32);
        const value = String(url);
        if (value.startsWith("https://database.test")) return okJson({});
        if (value.includes("oauth2.googleapis.com"))
          return scenario === "revoked"
            ? okJson({ error: "invalid_grant" }, 400)
            : okJson({ access_token: "test-access", expires_in: 3600 });
        const parsed = new URL(value);
        if (init?.method === "GET" && parsed.pathname.endsWith("/events")) {
          return okJson({
            items: [...remote.values()].filter(
              (event) => event.extendedProperties,
            ),
          });
        }
        const id = parsed.pathname.split("/").at(-1)!;
        if (init?.method === "GET")
          return remote.has(id) ? okJson(remote.get(id)) : okJson({}, 404);
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body));
          if (remote.has(body.id)) {
            duplicateCreates++;
            return okJson({}, 409);
          }
          remote.set(body.id, body);
          return okJson({ id: body.id });
        }
        if (init?.method === "PUT") {
          remote.set(id, { ...JSON.parse(String(init.body)), id });
          return okJson({ id });
        }
        if (init?.method === "DELETE") {
          if (scenario === "delete-retry" && !deleteFailed) {
            deleteFailed = true;
            return okJson({ error: "temporary provider failure" }, 503);
          }
          remote.delete(id);
          return new Response(null, { status: 204 });
        }
        throw new Error("Unexpected provider request");
      });
      if (scenario === "revoked") {
        await expect(
          syncGoogleSubscription("sub-existing", env, {
            maxExternalRequests: 32,
          }),
        ).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_INVALID" });
        expect(remote.size).toBe(1);
        return;
      }
      let completed = false;
      for (let attempt = 0; attempt < 8 && !completed; attempt++) {
        invocationRequests = 0;
        try {
          const result = await syncGoogleSubscription("sub-existing", env, {
            maxExternalRequests: 32,
          });
          completed = Boolean(result.lastSyncedAt);
        } catch (error) {
          if (
            scenario === "delete-retry" &&
            (error as { code?: string }).code === "GOOGLE_API_FAILED"
          ) {
            expect(mappings.has("removed-wednesday")).toBe(true);
            expect(remote.has("obsolete")).toBe(true);
          } else if (!(scenario === "crash" && crashed && attempt === 0))
            expect(error).toMatchObject({ code: "GOOGLE_SYNC_CONTINUE" });
        }
        counts.push(invocationRequests);
      }
      expect(completed).toBe(true);
      expect(counts.length).toBeGreaterThan(1);
      expect(counts.every((count) => count + 2 <= 34)).toBe(true); // claim + durable finish
      expect(remote.size).toBe(16);
      expect(remote.get("personal")).toEqual(unrelated);
      expect(remote.has("obsolete")).toBe(false);
      expect(mappings.size).toBe(15);
      expect(duplicateCreates).toBe(0);
      expect(JSON.stringify(source)).toBe(rawBefore);
      invocationRequests = 0;
      const again = await syncGoogleSubscription("sub-existing", env, {
        maxExternalRequests: 32,
      });
      expect(again).toMatchObject({
        created: 0,
        updated: 0,
        deleted: 0,
        unchanged: 15,
      });
    },
  );

  it("updates and deletes existing remote events by stable session key without creating a new calendar", async () => {
    const result = await syncGoogleSubscription("sub-existing", env);

    expect(result).toMatchObject({
      created: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(
      googleRepositoryMocks.getCurrentPublishedVersionId,
    ).not.toHaveBeenCalled();
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
    vi.mocked(fetch).mockImplementation(
      async (url: string | URL | Request, init?: RequestInit) => {
        const value = String(url);
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
        if (value === "https://oauth2.googleapis.com/token") {
          return okJson({ access_token: "access-token" });
        }
        return okJson({ error: { code: 503 } }, 503);
      },
    );

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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
    googleRepositoryMocks.updateGoogleSubscription.mockResolvedValue(true);
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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
      updated: 0,
      deleted: 0,
      unchanged: 0,
      ownershipReviewCount: 1,
    });
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-other-session?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("/events/event-tuesday?sendUpdates=none"),
      expect.objectContaining({ method: "PUT" }),
    );
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).not.toHaveBeenCalled();
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
        const ownership = ownershipFixture(value, init);
        if (ownership) return ownership;
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

  it.each([
    ["event-ise4105", {}],
    [
      "event-ise4105",
      {
        calenderzwTimetableId: "another-class",
        calenderzwStableSessionKey: "ise4105-tue-corrected",
      },
    ],
    [
      "event-ise4105",
      {
        calenderzwTimetableId: "tt-se41",
        calenderzwStableSessionKey: "another-session",
      },
    ],
    ["event-removed", {}],
    [
      "event-removed",
      {
        calenderzwTimetableId: "another-class",
        calenderzwStableSessionKey: "ise4105-wed-removed",
      },
    ],
    [
      "event-removed",
      {
        calenderzwTimetableId: "tt-se41",
        calenderzwStableSessionKey: "another-session",
      },
    ],
  ])(
    "preserves mapped event %s when its GET ownership differs: %j",
    async (eventId, privateTags) => {
      const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (
          String(url).endsWith(`/events/${eventId}`) &&
          init?.method === "GET"
        ) {
          return okJson({
            id: eventId,
            extendedProperties: { private: privateTags },
          });
        }
        return defaultFetch(url, init);
      });
      const preview = await previewGoogleSubscriptionSync("sub-existing", env);
      expect(preview).toMatchObject({
        ownershipReviewCount: 1,
        wouldDelete: eventId === "event-removed" ? 0 : 1,
      });
      expect(fetch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "PUT" }),
      );
      const result = await syncGoogleSubscription("sub-existing", env);
      expect(result.ownershipReviewCount).toBe(1);
      for (const method of ["PUT", "DELETE"]) {
        expect(fetch).not.toHaveBeenCalledWith(
          expect.stringContaining(`/events/${eventId}?`),
          expect.objectContaining({ method }),
        );
      }
      expect(
        googleRepositoryMocks.deleteGoogleEventSyncRecord,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({
          internalEventId:
            eventId === "event-removed"
              ? "ise4105-wed-removed"
              : "ise4105-tue-corrected",
        }),
      );
      expect(
        googleRepositoryMocks.updateGoogleSubscription,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          status: "failed",
          lastErrorCode: "GOOGLE_EVENT_OWNERSHIP_REVIEW",
        }),
      );
    },
  );

  it.each([404, 410])(
    "treats a mapped event GET %s as already absent without issuing DELETE",
    async (status) => {
      const defaultFetch = vi.mocked(fetch).getMockImplementation()!;
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (
          String(url).endsWith("/events/event-removed") &&
          init?.method === "GET"
        )
          return okJson({}, status);
        return defaultFetch(url, init);
      });
      expect(
        await previewGoogleSubscriptionSync("sub-existing", env),
      ).toMatchObject({ wouldDelete: 0, ownershipReviewCount: 0 });
      expect(await syncGoogleSubscription("sub-existing", env)).toMatchObject({
        deleted: 0,
        ownershipReviewCount: 0,
      });
      expect(fetch).not.toHaveBeenCalledWith(
        expect.stringContaining("/events/event-removed?"),
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(
        googleRepositoryMocks.deleteGoogleEventSyncRecord,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ internalEventId: "ise4105-wed-removed" }),
      );
    },
  );

  it("recovers a successful provider POST followed by a failed mapping save even when the retry list is empty", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([]);
    googleRepositoryMocks.upsertGoogleEventSyncRecord.mockRejectedValueOnce(
      new Error("mapping save interrupted"),
    );
    const remote = new Map<string, Record<string, unknown>>();
    const postedIds: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const value = String(url);
      if (value === "https://oauth2.googleapis.com/token")
        return okJson({ access_token: "access-token" });
      if (init?.method === "GET" && value.includes("/events?"))
        return okJson({ items: [] });
      if (
        init?.method === "POST" &&
        value.endsWith("/events?sendUpdates=none")
      ) {
        const payload = JSON.parse(String(init.body));
        postedIds.push(payload.id);
        if (remote.has(payload.id))
          return okJson({ error: { code: 409 } }, 409);
        remote.set(payload.id, payload);
        return okJson(payload);
      }
      const id = new URL(value).pathname.split("/").at(-1)!;
      if (init?.method === "GET" && remote.has(id))
        return okJson(remote.get(id));
      if (init?.method === "PUT" && remote.has(id)) {
        const payload = { ...JSON.parse(String(init.body)), id };
        remote.set(id, payload);
        return okJson(payload);
      }
      throw new Error(
        `Unexpected crash recovery fixture: ${init?.method} ${value}`,
      );
    });
    await expect(syncGoogleSubscription("sub-existing", env)).rejects.toThrow(
      "mapping save interrupted",
    );
    expect(remote.size).toBe(1);
    const retry = await syncGoogleSubscription("sub-existing", env);
    const expectedId = createHash("sha256")
      .update(
        JSON.stringify([
          "sub-existing",
          "tt-se41",
          "cal-existing",
          "ise4105-tue-corrected",
        ]),
      )
      .digest("hex");
    expect(postedIds).toEqual([expectedId, expectedId]);
    expect(remote.size).toBe(1);
    expect(retry).toMatchObject({
      created: 0,
      updated: 1,
      ownershipReviewCount: 0,
    });
    expect(
      googleRepositoryMocks.upsertGoogleEventSyncRecord,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({ externalEventId: expectedId }),
    );
  });

  it.each([
    {},
    {
      calenderzwTimetableId: "another-class",
      calenderzwStableSessionKey: "ise4105-tue-corrected",
    },
    {
      calenderzwTimetableId: "tt-se41",
      calenderzwStableSessionKey: "another-session",
    },
  ])(
    "rejects a deterministic ID collision without matching ownership: %j",
    async (privateTags) => {
      googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([]);
      let collisionId: string;
      vi.mocked(fetch).mockImplementation(async (url, init) => {
        if (String(url) === "https://oauth2.googleapis.com/token")
          return okJson({ access_token: "access-token" });
        if (init?.method === "GET" && String(url).includes("/events?"))
          return okJson({ items: [] });
        if (init?.method === "POST") {
          collisionId = JSON.parse(String(init.body)).id;
          return okJson({ error: { code: 409 } }, 409);
        }
        if (init?.method === "GET")
          return okJson({
            id: collisionId,
            status: "cancelled",
            extendedProperties: { private: privateTags },
          });
        throw new Error("Unexpected collision write");
      });
      await expect(
        syncGoogleSubscription("sub-existing", env),
      ).rejects.toMatchObject({ code: "GOOGLE_EVENT_OWNERSHIP_CONFLICT" });
      expect(fetch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "PUT" }),
      );
      expect(fetch).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ method: "DELETE" }),
      );
      expect(
        googleRepositoryMocks.upsertGoogleEventSyncRecord,
      ).not.toHaveBeenCalled();
    },
  );

  it.each([
    [400, "invalid_grant", "reconnect", "GOOGLE_CREDENTIAL_INVALID"],
    [429, "rate_limit_exceeded", "retry", "GOOGLE_REFRESH_FAILED"],
    [503, "temporarily_unavailable", "retry", "GOOGLE_REFRESH_FAILED"],
    [503, "invalid_grant", "retry", "GOOGLE_REFRESH_FAILED"],
  ])(
    "classifies refresh response %s/%s across the real sync/delivery boundary",
    async (status, error, outcome, code) => {
      vi.mocked(fetch).mockResolvedValueOnce(
        okJson({ error, error_description: "private-provider-value" }, status),
      );
      const finish = vi.fn().mockResolvedValue(true);
      const job = {
        subscriptionId: "sub-existing",
        revision: 1,
        leaseToken: "lease",
        attemptCount: 1,
        leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      };
      await deliverGoogleCalendarJob(
        job,
        async (claimed, signal) => {
          await syncGoogleSubscription(claimed.subscriptionId, env, { signal });
          return { completed: true };
        },
        { finish },
      );
      expect(finish).toHaveBeenCalledWith(job, outcome, code);
      expect(JSON.stringify(finish.mock.calls)).not.toContain(
        "private-provider-value",
      );
      expect(
        googleRepositoryMocks.upsertGoogleEventSyncRecord,
      ).not.toHaveBeenCalled();
    },
  );

  it("restores an exactly owned deterministic tombstone through create-delete-reactivate", async () => {
    googleRepositoryMocks.listGoogleEventSyncRecords.mockResolvedValue([]);
    const liveTimetable = timetable();
    repositoryMocks.getPublishedTimetableById.mockResolvedValue(liveTimetable);
    const remote = new Map<string, Record<string, unknown>>();
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const value = String(url);
      if (value === "https://oauth2.googleapis.com/token")
        return okJson({ access_token: "access" });
      if (init?.method === "GET" && value.includes("/events?"))
        return okJson({
          items: [...remote.values()].filter(
            (item) => item.status !== "cancelled",
          ),
        });
      const id = new URL(value).pathname.split("/").at(-1)!;
      if (init?.method === "GET")
        return remote.has(id) ? okJson(remote.get(id)) : okJson({}, 404);
      if (init?.method === "POST") {
        const item = JSON.parse(String(init.body));
        if (remote.has(item.id)) return okJson({ error: { code: 409 } }, 409);
        remote.set(item.id, item);
        return okJson(item);
      }
      if (init?.method === "DELETE") {
        remote.set(id, { ...remote.get(id), status: "cancelled" });
        return new Response(null, { status: 204 });
      }
      if (init?.method === "PUT") {
        const item = { ...JSON.parse(String(init.body)), id };
        remote.set(id, item);
        return okJson(item);
      }
      throw new Error("Unexpected tombstone request");
    });
    expect(await syncGoogleSubscription("sub-existing", env)).toMatchObject({
      created: 1,
    });
    const id = [...remote.keys()][0];
    repositoryMocks.getPublishedTimetableById.mockResolvedValue({
      ...liveTimetable,
      sessions: [],
    });
    expect(await syncGoogleSubscription("sub-existing", env)).toMatchObject({
      deleted: 1,
    });
    expect(remote.get(id)?.status).toBe("cancelled");
    repositoryMocks.getPublishedTimetableById.mockResolvedValue(liveTimetable);
    expect(await syncGoogleSubscription("sub-existing", env)).toMatchObject({
      created: 0,
      updated: 1,
    });
    expect(remote.size).toBe(1);
    expect(remote.get(id)?.status).toBe("confirmed");
  });

  it("queries active and failed subscriptions as syncable, while excluding revoked rows", () => {
    const source = readFileSync("server/googleCalendarRepository.ts", "utf8");

    expect(source).toContain("listSyncableGoogleSubscriptions");
    expect(source).toContain('.in("status", ["active", "failed"])');
    expect(source).toContain('.is("revoked_at", null)');
  });
});
