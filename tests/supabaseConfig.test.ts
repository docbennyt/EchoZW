import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "../src/utils/supabase/config";

function env(values: Record<string, string>) {
  return values as unknown as ImportMetaEnv;
}

describe("Supabase configuration", () => {
  it("prefers runtime config over build-time browser variables", () => {
    expect(
      getSupabaseConfig(
        env({
          VITE_SUPABASE_URL: "https://build.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "build-key",
        }),
        {
          supabaseUrl: "https://runtime.supabase.co",
          supabasePublishableKey: "runtime-key",
          publicAppUrl: "https://calender.aido.co.zw",
          releaseSha: "release-1",
        },
      ),
    ).toEqual({
      url: "https://runtime.supabase.co",
      publishableKey: "runtime-key",
    });
  });

  it("prefers Vite public environment variables", () => {
    expect(
      getSupabaseConfig(
        env({
          VITE_SUPABASE_URL: "https://vite.supabase.co",
          VITE_SUPABASE_PUBLISHABLE_KEY: "vite-key",
          NEXT_PUBLIC_SUPABASE_URL: "https://next.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "next-key",
        }),
      ),
    ).toEqual({
      url: "https://vite.supabase.co",
      publishableKey: "vite-key",
    });
  });

  it("accepts the Next.js public variable names for copied examples", () => {
    expect(
      getSupabaseConfig(
        env({
          NEXT_PUBLIC_SUPABASE_URL: "https://next.supabase.co",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "next-key",
        }),
      ),
    ).toEqual({
      url: "https://next.supabase.co",
      publishableKey: "next-key",
    });
  });

  it("fails clearly when public Supabase config is missing", () => {
    expect(() => getSupabaseConfig(env({}), undefined)).toThrow(
      /Browser Supabase runtime configuration is missing/,
    );
  });

  it("initializes shared admin and recovery auth config from runtime values", () => {
    const config = getSupabaseConfig(env({}), {
      supabaseUrl: "https://runtime.supabase.co",
      supabasePublishableKey: "runtime-key",
    });

    expect(config.url).toBe("https://runtime.supabase.co");
    expect(config.publishableKey).toBe("runtime-key");
  });
});
