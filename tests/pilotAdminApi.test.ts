import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  createTimetable: vi.fn(),
  getCalendarSubscriptionById: vi.fn(),
  getTimetableEditor: vi.fn(),
  publishTimetable: vi.fn(),
}));

const googleSyncMocks = vi.hoisted(() => ({
  previewGoogleSubscriptionSync: vi.fn(),
  previewGoogleSubscriptionsForTimetable: vi.fn(),
  syncGoogleSubscription: vi.fn(),
  syncGoogleSubscriptionsForTimetable: vi.fn(),
}));

vi.mock("../server/pilotRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../server/pilotRepository")
  >("../server/pilotRepository");

  return {
    ...actual,
    createTimetable: repositoryMocks.createTimetable,
    getCalendarSubscriptionById: repositoryMocks.getCalendarSubscriptionById,
    getTimetableEditor: repositoryMocks.getTimetableEditor,
    publishTimetable: repositoryMocks.publishTimetable,
  };
});

vi.mock("../server/googleCalendarSync", () => googleSyncMocks);

import { handlePilotAdminApi } from "../server/pilotAdminApi";

function request(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = Readable.from(
    body === undefined ? [] : [JSON.stringify(body)],
  ) as IncomingMessage;
  Object.assign(stream, {
    method,
    url,
    headers: body === undefined ? {} : { "content-type": "application/json" },
  });
  return stream;
}

function response() {
  const chunks: string[] = [];
  const res = new EventEmitter() as ServerResponse & {
    statusCode?: number;
    headers?: Record<string, string>;
  };
  res.writeHead = ((statusCode: number, headers: Record<string, string>) => {
    res.statusCode = statusCode;
    res.headers = headers;
    return res;
  }) as ServerResponse["writeHead"];
  res.end = ((chunk?: string) => {
    if (chunk) chunks.push(chunk);
    res.emit("finish");
    return res;
  }) as ServerResponse["end"];
  return {
    res,
    body: () => JSON.parse(chunks.join("")),
  };
}

const editor = {
  timetable: {
    id: "11111111-1111-4111-8111-111111111111",
    publicSlug: "hit-cs-1-1-august-2026",
    institutionId: "22222222-2222-4222-8222-222222222222",
    institutionName: "Harare Institute of Technology",
    programmeId: "33333333-3333-4333-8333-333333333333",
    programmeName: "BTech Computer Science",
    classGroupId: "44444444-4444-4444-8444-444444444444",
    classGroupLabel: "1.1",
    academicPeriodId: "55555555-5555-4555-8555-555555555555",
    academicPeriodName: "August Semester 2026",
    academicPeriodStartsOn: "2026-08-10",
    academicPeriodEndsOn: "2026-12-10",
    currentPublishedVersionId: null,
  },
  activeVersion: {
    id: "66666666-6666-4666-8666-666666666666",
    versionNumber: 1,
    status: "draft" as const,
    publishedAt: null,
    changeSummary: "Initial draft",
    createdAt: "2026-08-07T10:00:00.000Z",
    sessionCount: 0,
  },
  versions: [],
  sessions: [],
};

describe("pilot timetable admin API contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    googleSyncMocks.syncGoogleSubscriptionsForTimetable.mockResolvedValue({
      attempted: 0,
      succeeded: 0,
      failed: 0,
    });
    googleSyncMocks.syncGoogleSubscription.mockResolvedValue({
      created: 0,
      updated: 0,
      deleted: 0,
      unchanged: 15,
    });
    googleSyncMocks.previewGoogleSubscriptionSync.mockResolvedValue({
      subscriptionId: "99999999-9999-4999-8999-999999999999",
      timetableId: "tt-1",
      readOnly: true,
      expectedEvents: 15,
      remoteManagedEvents: 16,
      localMappings: 15,
      wouldCreate: 0,
      wouldUpdate: 0,
      wouldDelete: 1,
      unchanged: 15,
    });
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValue({
      id: "99999999-9999-4999-8999-999999999999",
      provider: "google_api",
      timetable_id: "tt-1",
      status: "active",
      revoked_at: null,
    });
  });

  it("returns timetable and draftVersion when timetable metadata is created", async () => {
    repositoryMocks.createTimetable.mockResolvedValueOnce(editor);

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables", {
        institutionId: "22222222-2222-4222-8222-222222222222",
        programmeId: "33333333-3333-4333-8333-333333333333",
        classGroupId: "44444444-4444-4444-8444-444444444444",
        academicPeriodId: "55555555-5555-4555-8555-555555555555",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(201);
    expect(body()).toEqual({
      timetable: editor,
      draftVersion: editor.activeVersion,
    });
  });

  it("returns the unpublished admin editor payload under the timetable key", async () => {
    repositoryMocks.getTimetableEditor.mockResolvedValueOnce(editor);

    const { res, body } = response();
    await handlePilotAdminApi(
      request("GET", "/api/admin/timetables/tt-1"),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({
      timetable: editor,
    });
  });

  it("returns publishResult and Google propagation summary for timetable publication", async () => {
    repositoryMocks.publishTimetable.mockResolvedValueOnce({
      publicSlug: "hit-cs-1-1-august-2026",
      versionNumber: 1,
      sessionCount: 5,
      publishedAt: "2026-08-07T12:00:00.000Z",
    });

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/publish"),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(body()).toEqual({
      publishResult: {
        publicSlug: "hit-cs-1-1-august-2026",
        versionNumber: 1,
        sessionCount: 5,
        publishedAt: "2026-08-07T12:00:00.000Z",
      },
      googleCalendarSync: {
        attempted: 0,
        succeeded: 0,
        failed: 0,
      },
    });
  });

  it("retries Google propagation for a timetable without requiring another publication", async () => {
    googleSyncMocks.syncGoogleSubscriptionsForTimetable.mockResolvedValueOnce({
      attempted: 2,
      succeeded: 1,
      failed: 1,
    });

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync"),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(
      googleSyncMocks.syncGoogleSubscriptionsForTimetable,
    ).toHaveBeenCalledWith("tt-1");
    expect(body()).toEqual({
      googleCalendarSync: {
        attempted: 2,
        succeeded: 1,
        failed: 1,
      },
    });
  });

  it("previews Google propagation without mutating remote calendars", async () => {
    googleSyncMocks.previewGoogleSubscriptionsForTimetable.mockResolvedValueOnce(
      {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        readOnly: true,
        previews: [
          {
            subscriptionId: "sub-1",
            readOnly: true,
            expectedEvents: 15,
            wouldDelete: 1,
          },
        ],
      },
    );

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: true,
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(
      googleSyncMocks.previewGoogleSubscriptionsForTimetable,
    ).toHaveBeenCalledWith("tt-1");
    expect(
      googleSyncMocks.syncGoogleSubscriptionsForTimetable,
    ).not.toHaveBeenCalled();
    expect(body()).toEqual({
      googleCalendarSync: {
        attempted: 1,
        succeeded: 1,
        failed: 0,
        readOnly: true,
        previews: [
          {
            subscriptionId: "sub-1",
            readOnly: true,
            expectedEvents: 15,
            wouldDelete: 1,
          },
        ],
      },
    });
  });

  it("previews one Google subscription without running the bulk preview", async () => {
    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: true,
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(repositoryMocks.getCalendarSubscriptionById).toHaveBeenCalledWith(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(googleSyncMocks.previewGoogleSubscriptionSync).toHaveBeenCalledWith(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(
      googleSyncMocks.previewGoogleSubscriptionsForTimetable,
    ).not.toHaveBeenCalled();
    expect(
      googleSyncMocks.syncGoogleSubscriptionsForTimetable,
    ).not.toHaveBeenCalled();
    expect(body()).toEqual({
      googleCalendarSync: {
        subscriptionId: "99999999-9999-4999-8999-999999999999",
        timetableId: "tt-1",
        readOnly: true,
        expectedEvents: 15,
        remoteManagedEvents: 16,
        localMappings: 15,
        wouldCreate: 0,
        wouldUpdate: 0,
        wouldDelete: 1,
        unchanged: 15,
      },
    });
  });

  it("requires explicit dryRun intent before targeting a Google subscription", async () => {
    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(400);
    expect(body()).toMatchObject({
      error: { code: "GOOGLE_RECONCILIATION_MODE_REQUIRED" },
    });
    expect(googleSyncMocks.previewGoogleSubscriptionSync).not.toHaveBeenCalled();
    expect(googleSyncMocks.syncGoogleSubscription).not.toHaveBeenCalled();
  });

  it("reconciles one Google subscription without running the bulk sync", async () => {
    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: false,
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(200);
    expect(googleSyncMocks.syncGoogleSubscription).toHaveBeenCalledWith(
      "99999999-9999-4999-8999-999999999999",
    );
    expect(
      googleSyncMocks.syncGoogleSubscriptionsForTimetable,
    ).not.toHaveBeenCalled();
    expect(body()).toEqual({
      googleCalendarSync: {
        created: 0,
        updated: 0,
        deleted: 0,
        unchanged: 15,
      },
    });
  });

  it("rejects a targeted subscription that belongs to another timetable", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      provider: "google_api",
      timetable_id: "other-tt",
      status: "active",
      revoked_at: null,
    });

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: true,
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(403);
    expect(body()).toMatchObject({
      error: { code: "SUBSCRIPTION_TIMETABLE_MISMATCH" },
    });
    expect(
      googleSyncMocks.previewGoogleSubscriptionSync,
    ).not.toHaveBeenCalled();
    expect(googleSyncMocks.syncGoogleSubscription).not.toHaveBeenCalled();
  });

  it("rejects targeted non-Google subscriptions", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      provider: "apple",
      timetable_id: "tt-1",
      status: "active",
      revoked_at: null,
    });

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: true,
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(400);
    expect(body()).toMatchObject({
      error: { code: "SUBSCRIPTION_PROVIDER_INVALID" },
    });
    expect(
      googleSyncMocks.previewGoogleSubscriptionSync,
    ).not.toHaveBeenCalled();
  });

  it("rejects targeted disconnected Google subscriptions before provider work", async () => {
    repositoryMocks.getCalendarSubscriptionById.mockResolvedValueOnce({
      id: "99999999-9999-4999-8999-999999999999",
      provider: "google_api",
      timetable_id: "tt-1",
      status: "disconnected",
      revoked_at: null,
    });

    const { res, body } = response();
    await handlePilotAdminApi(
      request("POST", "/api/admin/timetables/tt-1/google-calendar-sync", {
        dryRun: true,
        subscriptionId: "99999999-9999-4999-8999-999999999999",
      }),
      res,
      { id: "77777777-7777-4777-8777-777777777777" },
    );

    expect(res.statusCode).toBe(409);
    expect(body()).toMatchObject({
      error: { code: "SUBSCRIPTION_DISCONNECTED" },
    });
    expect(
      googleSyncMocks.previewGoogleSubscriptionSync,
    ).not.toHaveBeenCalled();
  });
});
