import { describe, expect, it } from "vitest";
import { createViteServerAuthDependencies } from "../server/viteCalendarPlugin";

describe("Vite server auth dependencies", () => {
  it("uses injected server-only Supabase config for admin middleware", () => {
    const deps = createViteServerAuthDependencies({
      SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "publishable",
      SUPABASE_SECRET_KEY: "server-secret",
    });

    expect(() => deps.createAdminClient?.()).not.toThrow();
    expect(() => deps.createUserClient?.("access-token")).not.toThrow();
  });
});
