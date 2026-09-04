import { describe, expect, it, vi } from "vitest";
import {
  formatSmokeResult,
  parseArgs,
  runReadinessSmoke,
} from "../scripts/verify-production-readiness.mjs";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("deployment readiness smoke", () => {
  it("normalizes origin and verifies readiness, public timetable, and session canaries", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health/ready") {
        return jsonResponse({
          status: "ready",
          dependencies: { schema: "ok" },
        });
      }
      if (path.startsWith("/api/public/timetables/")) {
        return jsonResponse({
          timetable: { publicSlug: "hit-ics-1-1-august-semester-2026" },
        });
      }
      if (path === "/api/admin/session") {
        return jsonResponse({ error: { code: "AUTH_REQUIRED" } }, 401);
      }
      return jsonResponse({}, 404);
    });

    const result = await runReadinessSmoke(
      {
        origin: "https://calender.aido.co.zw/ignored?x=1",
        timetableSlug: "hit-ics-1-1-august-semester-2026",
      },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(result.origin).toBe("https://calender.aido.co.zw");
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://calender.aido.co.zw/api/health/ready",
      expect.anything(),
    );
  });

  it("fails before rollout when schema readiness is incompatible", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health/ready") {
        return jsonResponse(
          {
            status: "not_ready",
            dependencies: { schema: "incompatible" },
          },
          503,
        );
      }
      if (path.startsWith("/api/public/timetables/")) {
        return jsonResponse({ timetable: { publicSlug: "canary" } });
      }
      return jsonResponse({ error: { code: "AUTH_REQUIRED" } }, 401);
    });

    const result = await runReadinessSmoke(
      { origin: "https://candidate.example", timetableSlug: "canary" },
      fetchImpl,
    );

    expect(result.ok).toBe(false);
    expect(result.results[0]).toMatchObject({
      route: "/api/health/ready",
      status: 503,
      ok: false,
    });
  });

  it("uses an optional admin token without printing it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === "/api/health/ready") {
        return jsonResponse({
          status: "ready",
          dependencies: { schema: "ok" },
        });
      }
      if (path.startsWith("/api/public/timetables/")) {
        return jsonResponse({ timetable: { publicSlug: "canary" } });
      }
      return jsonResponse({ authenticated: true }, 200);
    });

    const result = await runReadinessSmoke(
      {
        origin: "https://candidate.example",
        timetableSlug: "canary",
        adminBearerToken: "secret-admin-token",
      },
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(fetchImpl.mock.calls[2][1]?.headers).toMatchObject({
      authorization: "Bearer secret-admin-token",
    });
    expect(formatSmokeResult(result)).not.toContain("secret-admin-token");
  });

  it("parses env and CLI values without defaulting to production accidentally", () => {
    expect(
      parseArgs(["--origin", "https://candidate.example"], {
        CALENDERZW_SMOKE_TIMETABLE_SLUG: "env-slug",
      } as NodeJS.ProcessEnv),
    ).toMatchObject({
      origin: "https://candidate.example",
      timetableSlug: "env-slug",
    });

    expect(() => parseArgs(["--unknown"], {} as NodeJS.ProcessEnv)).toThrow(
      "Unknown or incomplete argument",
    );
  });
});
