import { describe, expect, it } from "vitest";
import {
  buildRuntimePublicConfig,
  releaseShaFromEnv,
  runtimeConfigResponseHeaders,
  runtimeConfigHasOnlyPublicValues,
  serializeRuntimeConfigScript,
} from "../server/runtimePublicConfig";

describe("runtime public config", () => {
  it("serializes only public browser configuration", () => {
    const script = serializeRuntimeConfigScript(
      buildRuntimePublicConfig({
        SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
        SUPABASE_ANON_KEY: "public-anon-key",
        SUPABASE_SECRET_KEY: "server-secret",
        GOOGLE_CLIENT_SECRET: "google-secret",
        CALENDAR_TOKEN_HASH_SECRET: "calendar-secret",
        PUBLIC_APP_URL: "https://calender.aido.co.zw",
        RAILWAY_GIT_COMMIT_SHA: "railway-abc123",
        GITHUB_SHA: "github-fallback",
      }),
    );

    expect(script).toContain("window.__CALENDERZW_RUNTIME_CONFIG__");
    expect(script).toContain("public-anon-key");
    expect(script).toContain("railway-abc123");
    expect(script).not.toContain("github-fallback");
    expect(script).not.toContain("server-secret");
    expect(script).not.toContain("google-secret");
    expect(script).not.toContain("calendar-secret");
    expect(runtimeConfigHasOnlyPublicValues(script)).toBe(true);
  });

  it("prefers Railway deployment metadata when available", () => {
    expect(
      releaseShaFromEnv({
        RAILWAY_GIT_COMMIT_SHA: "railway-sha",
        VERCEL_GIT_COMMIT_SHA: "vercel-sha",
        GITHUB_SHA: "github-sha",
      } as NodeJS.ProcessEnv),
    ).toBe("railway-sha");
  });

  it("uses no-store caching so browser auth config cannot go stale", () => {
    expect(runtimeConfigResponseHeaders(42)).toMatchObject({
      "Cache-Control": "no-store",
    });
  });
});
