import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  createTimetable: vi.fn(),
  getTimetableEditor: vi.fn(),
  publishTimetable: vi.fn(),
}));

vi.mock("../server/pilotRepository", async () => {
  const actual = await vi.importActual<
    typeof import("../server/pilotRepository")
  >("../server/pilotRepository");

  return {
    ...actual,
    createTimetable: repositoryMocks.createTimetable,
    getTimetableEditor: repositoryMocks.getTimetableEditor,
    publishTimetable: repositoryMocks.publishTimetable,
  };
});

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

  it("returns publishResult for timetable publication", async () => {
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
    });
  });
});
