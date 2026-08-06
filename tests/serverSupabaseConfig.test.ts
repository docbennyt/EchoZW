import { describe, expect, it, vi } from "vitest";
import {
  getServerSupabaseConfig,
  parseAdminEmailAllowlist,
  validateSupabaseProductionConfig,
} from "../server/supabase/config";
import { checkSupabaseConnectivity } from "../server/supabase/connectivity";

describe("server Supabase configuration", () => {
  it("parses the project host without exposing keys", () => {
    const config = getServerSupabaseConfig({
      SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SERVICE_ROLE_KEY: "server-secret",
    });

    expect(config.projectHost).toBe("jkafqgdymfiiklmozvhi.supabase.co");
    expect(config).not.toHaveProperty("serviceRoleKey", "publishable");
  });

  it("requires service-role config for production admin authorization", () => {
    expect(() =>
      validateSupabaseProductionConfig({
        SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      }),
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("normalizes the one-time admin bootstrap allowlist", () => {
    expect(parseAdminEmailAllowlist(" Admin@Example.test, second@example.test ")).toEqual([
      "admin@example.test",
      "second@example.test",
    ]);
  });

  it("reports project reachability without returning keys", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(
      checkSupabaseConnectivity(
        {
          SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
        },
        fetchImpl,
      ),
    ).resolves.toEqual({
      configured: true,
      reachable: true,
      projectHost: "jkafqgdymfiiklmozvhi.supabase.co",
      authConfigured: true,
      status: "PROJECT_REACHABLE",
    });
  });

  it("differentiates missing config from network failure", async () => {
    await expect(checkSupabaseConnectivity({})).resolves.toMatchObject({
      configured: false,
      status: "CONFIGURATION_MISSING",
    });

    await expect(
      checkSupabaseConnectivity(
        {
          SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
        },
        vi.fn(async () => {
          throw new Error("DNS failed");
        }),
      ),
    ).resolves.toMatchObject({
      configured: true,
      reachable: false,
      status: "NETWORK_ERROR",
    });
  });
});
