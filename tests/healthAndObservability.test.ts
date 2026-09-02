import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { handleHealthRequest } from "../server/healthApi";
import {
  classifyRoute,
  sanitizeForLog,
  logUnknownRequestError,
} from "../server/observability";
import { checkSchemaCompatibility } from "../server/schemaCompatibility";
import type { SchemaCompatibilityResult } from "../server/schemaCompatibility";
import type { SupabaseConnectivityResult } from "../server/supabase/connectivity";

function makeRequest(method: string, url: string) {
  const request = Readable.from([]) as Readable & Partial<IncomingMessage>;
  request.method = method;
  request.url = url;
  request.headers = {
    authorization: "Bearer should-not-log",
  };
  return request as IncomingMessage;
}

function makeResponse() {
  const capture = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: "",
  };
  const response = {
    writeHead(statusCode: number, headers?: Record<string, string>) {
      capture.statusCode = statusCode;
      capture.headers = Object.fromEntries(
        Object.entries(headers ?? {}).map(([key, value]) => [
          key.toLowerCase(),
          String(value),
        ]),
      );
      return response;
    },
    end(chunk?: string | Buffer) {
      if (chunk)
        capture.body += Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
      return response;
    },
    setHeader(key: string, value: string) {
      capture.headers[key.toLowerCase()] = value;
    },
  } as unknown as ServerResponse;
  return { response, capture };
}

const env = {
  SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SECRET_KEY: "server-secret",
  PUBLIC_APP_URL: "https://calender.aido.co.zw",
} as NodeJS.ProcessEnv;

describe("health and observability", () => {
  it("serves live health without dependency checks", async () => {
    const { response, capture } = makeResponse();

    await expect(
      handleHealthRequest(makeRequest("GET", "/api/health/live"), response, {}),
    ).resolves.toBe(true);

    expect(capture.statusCode).toBe(200);
    expect(JSON.parse(capture.body)).toEqual({ status: "ok" });
  });

  it("ready health catches schema incompatibility without exposing secrets", async () => {
    const { response, capture } = makeResponse();

    await handleHealthRequest(
      makeRequest("GET", "/api/health/ready"),
      response,
      env,
      {
        checkConnectivity: vi.fn(
          async () =>
            ({
              configured: true,
              reachable: true,
              authConfigured: true,
              projectHost: "jkafqgdymfiiklmozvhi.supabase.co",
              status: "PROJECT_REACHABLE",
            }) satisfies SupabaseConnectivityResult,
        ),
        checkSchema: vi.fn(async () => {
          return {
            status: "incompatible",
            requiredCount: 8,
            failures: [
              {
                object: "calendar_subscriptions.subscriber_profile_id",
                code: "MISSING_OR_INCOMPATIBLE",
              },
            ],
          } satisfies SchemaCompatibilityResult;
        }),
      },
    );

    expect(capture.statusCode).toBe(503);
    expect(capture.headers["cache-control"]).toBe("no-store");
    expect(capture.body).not.toContain("server-secret");
    expect(JSON.parse(capture.body).dependencies.schema).toBe("incompatible");
  });

  it("detects schema compatibility with safe non-mutating probes", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );

    await expect(
      checkSchemaCompatibility(env, fetchImpl),
    ).resolves.toMatchObject({
      status: "ok",
      failures: [],
    });
    expect(
      fetchImpl.mock.calls.some((call) => {
        const [url, init] = call;
        return (
          String(url).includes(
            "/rpc/create_calendar_subscription_with_profile",
          ) && init?.method === "OPTIONS"
        );
      }),
    ).toBe(true);
  });

  it("uses the privileged API key without inventing an opaque Bearer JWT", async () => {
    const modernEnv = {
      ...env,
      SUPABASE_SECRET_KEY: "sb_secret_server_only",
    } as NodeJS.ProcessEnv;
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );

    await checkSchemaCompatibility(modernEnv, fetchImpl);

    for (const [, init] of fetchImpl.mock.calls) {
      expect(init?.headers).toMatchObject({ apikey: "sb_secret_server_only" });
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
    }
  });

  it("probes the actual timetable exception correction columns", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );

    await checkSchemaCompatibility(env, fetchImpl);

    const exceptionProbe = fetchImpl.mock.calls.find(([url]) =>
      String(url).includes("/rest/v1/timetable_session_exceptions?"),
    );
    expect(exceptionProbe).toBeTruthy();
    const url = String(exceptionProbe?.[0]);
    expect(url).toContain("exception_type");
    expect(url).toContain("replacement_starts_at");
    expect(url).toContain("replacement_ends_at");
    expect(url).toContain("start_time");
    expect(url).toContain("end_time");
    expect(url).not.toContain("starts_at,ends_at,cancelled");
  });

  it("redacts private feed URLs, auth headers, phone, email, and tokens from logs", () => {
    expect(classifyRoute("/cdn-cgi/rum")).toMatchObject({
      category: "static",
    });
    expect(classifyRoute("/calendar/feed/private-token.ics")).toEqual({
      category: "calendar_feed",
      template: "/calendar/feed/:redacted",
    });

    const sanitized = sanitizeForLog({
      authorization: "Bearer private",
      email: "admin@example.test",
      phone: "+263771234567",
      url: "/calendar/feed/private-token.ics",
      token: "private-token",
      route: classifyRoute("/calendar/feed/private-token.ics").template,
    });

    expect(JSON.stringify(sanitized)).not.toContain("admin@example.test");
    expect(JSON.stringify(sanitized)).not.toContain("+263771234567");
    expect(JSON.stringify(sanitized)).not.toContain("private-token");
    expect(JSON.stringify(sanitized)).toContain("/calendar/feed/:redacted");
  });

  it("keeps safe startup diagnostic booleans while redacting actual secret fields", () => {
    const sanitized = sanitizeForLog({
      calendar: {
        tokenHashSecretConfigured: true,
        tokenHashSecret: "real-secret",
      },
    });

    expect(sanitized).toEqual({
      calendar: {
        tokenHashSecretConfigured: true,
        tokenHashSecret: "redacted",
      },
    });
  });

  it("logs unknown errors with request IDs and no raw secrets", () => {
    const logger = { error: vi.fn() };
    logUnknownRequestError({
      error: new Error("SUPABASE_SECRET_KEY=secret admin@example.test"),
      requestId: "req-1",
      route: classifyRoute("/api/admin/session"),
      durationMs: 12,
      logger,
    });

    const payload = logger.error.mock.calls[0][0] as string;
    expect(payload).toContain("req-1");
    expect(payload).not.toContain("secret");
    expect(payload).not.toContain("admin@example.test");
  });
});
