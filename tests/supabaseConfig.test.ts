import { describe, expect, it } from "vitest";
import { getSupabaseConfig } from "../src/utils/supabase/config";

function env(values: Record<string, string>) {
  return values as unknown as ImportMetaEnv;
}

describe("Supabase configuration", () => {
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
    expect(() => getSupabaseConfig(env({}))).toThrow(/VITE_SUPABASE_URL/);
  });
});
