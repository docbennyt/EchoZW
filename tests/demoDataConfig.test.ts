import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDemoDataAllowed } from "../src/domain/demoConfig";
import { demoTimetable } from "../src/domain/timetableData";

vi.mock("node:fs/promises", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  return {
    ...actual,
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async () => {
      throw new Error("store unavailable");
    }),
    writeFile: vi.fn(async () => undefined),
  };
});

const { handleCalendarRequest } = await import("../server/viteCalendarPlugin");

type ResponseSnapshot = {
  statusCode: number;
  headers: Record<string, string | number | readonly string[]>;
  body: string;
};

function makeRequest(input: {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}) {
  const body =
    typeof input.body === "undefined" ? "" : JSON.stringify(input.body);
  const req = Readable.from(body) as Readable & {
    method: string;
    url: string;
    headers: Record<string, string>;
  };
  req.method = input.method;
  req.url = input.url;
  req.headers = {
    host: "localhost:5173",
    ...input.headers,
  };
  return req;
}

function makeResponse() {
  const snapshot: ResponseSnapshot = {
    statusCode: 0,
    headers: {},
    body: "",
  };
  const res = {
    writeHead(
      statusCode: number,
      headers: Record<string, string | number | readonly string[]> = {},
    ) {
      snapshot.statusCode = statusCode;
      snapshot.headers = { ...snapshot.headers, ...headers };
      return res;
    },
    end(chunk?: string | Buffer) {
      if (chunk) snapshot.body += chunk.toString();
      return res;
    },
  };
  return { res, snapshot };
}

async function dispatch(input: {
  method: string;
  url: string;
  body?: unknown;
  mode?: "development" | "production";
  headers?: Record<string, string>;
}) {
  const { res, snapshot } = makeResponse();
  const handled = await handleCalendarRequest(
    makeRequest(input) as never,
    res as never,
    input.mode ?? "development",
  );
  return { handled, ...snapshot };
}

function subscriptionRequest() {
  return {
    timetableId: demoTimetable.id,
    provider: "webcal_subscription",
    reminderPreset: "prepared",
    customReminderOffsets: [],
    timezone: "Africa/Harare",
  };
}

describe("demo data configuration", () => {
  beforeEach(() => {
    delete process.env.ALLOW_DEMO_DATA;
    delete process.env.APP_ENV;
    process.env.NODE_ENV = "test";
  });

  it("defaults demo data off", () => {
    expect(isDemoDataAllowed({})).toBe(false);
  });

  it("allows demo data only through an explicit non-production environment value", () => {
    expect(isDemoDataAllowed({ ALLOW_DEMO_DATA: "true" })).toBe(true);
    expect(isDemoDataAllowed({ ALLOW_DEMO_DATA: "false" })).toBe(false);
  });

  it("forces demo mode off when production is indicated", () => {
    expect(
      isDemoDataAllowed({
        ALLOW_DEMO_DATA: "true",
        APP_ENV: "production",
      }),
    ).toBe(false);
    expect(
      isDemoDataAllowed({
        ALLOW_DEMO_DATA: "true",
        NODE_ENV: "production",
      }),
    ).toBe(false);
    expect(isDemoDataAllowed({ ALLOW_DEMO_DATA: "true" }, "production")).toBe(
      false,
    );
  });
});

describe("calendar API demo-data guard", () => {
  beforeEach(() => {
    delete process.env.ALLOW_DEMO_DATA;
    delete process.env.APP_ENV;
    process.env.NODE_ENV = "test";
    process.env.PUBLIC_APP_URL = "http://localhost:5173";
  });

  it("rejects demo-backed subscription creation when demo data is disabled", async () => {
    const response = await dispatch({
      method: "POST",
      url: "/api/calendar/subscriptions",
      body: subscriptionRequest(),
    });

    expect(response.handled).toBe(true);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe(
      "TIMETABLE_NOT_PUBLISHED",
    );
  });

  it("does not silently fall back after the subscription store cannot load", async () => {
    const response = await dispatch({
      method: "POST",
      url: "/api/calendar/subscriptions",
      body: subscriptionRequest(),
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("feedUrl");
    expect(response.body).not.toContain("calendarName");
  });

  it("rejects demo-backed calendar feeds when demo data is disabled", async () => {
    const response = await dispatch({
      method: "GET",
      url: "/calendar/feed/dev-token.ics",
    });

    expect(response.handled).toBe(true);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe(
      "TIMETABLE_NOT_PUBLISHED",
    );
  });

  it("rejects demo-backed .ics downloads when demo data is disabled", async () => {
    const response = await dispatch({
      method: "GET",
      url: "/calendar/download/subscription-id.ics",
    });

    expect(response.handled).toBe(true);
    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe(
      "TIMETABLE_NOT_PUBLISHED",
    );
  });

  it("keeps explicit development demo mode available", async () => {
    process.env.ALLOW_DEMO_DATA = "true";
    const created = await dispatch({
      method: "POST",
      url: "/api/calendar/subscriptions",
      body: subscriptionRequest(),
    });

    expect(created.statusCode).toBe(201);
    const body = JSON.parse(created.body) as { feedUrl: string };
    expect(body.feedUrl).toContain("/calendar/feed/");

    const feedPath = new URL(body.feedUrl).pathname;
    const feed = await dispatch({
      method: "GET",
      url: feedPath,
    });

    expect(feed.statusCode).toBe(200);
    expect(feed.body).toContain("BEGIN:VCALENDAR");
    expect(feed.body).toContain("BSc Software Engineering");
  });

  it("forces explicit demo mode off in production calendar handling", async () => {
    process.env.ALLOW_DEMO_DATA = "true";
    const response = await dispatch({
      method: "POST",
      url: "/api/calendar/subscriptions",
      body: subscriptionRequest(),
      mode: "production",
    });

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body).error.code).toBe(
      "TIMETABLE_NOT_PUBLISHED",
    );
  });
});
