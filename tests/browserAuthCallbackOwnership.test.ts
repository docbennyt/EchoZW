import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createBrowserClient: mocks.create }));
vi.mock("../src/utils/supabase/config", () => ({
  getSupabaseConfig: () => ({
    url: "https://fixture.supabase.co",
    publishableKey: "fixture-public",
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.create.mockReset().mockReturnValue({ auth: {} });
  window.history.replaceState({}, "", "/");
});

describe("browser auth callback ownership", () => {
  it.each(["/account/update-password", "/auth/confirm", "/auth/callback"])(
    "leaves %s exchange exclusively to its application handler",
    async (path) => {
      window.history.replaceState({}, "", `${path}?code=fixture-code`);
      const { createClient } = await import("../src/utils/supabase/client");
      createClient();
      const options = mocks.create.mock.calls[0][2];
      expect(options?.auth?.detectSessionInUrl).toBe(false);
    },
  );

  it("retains singleton reuse and does not disable session persistence or refresh", async () => {
    const { createClient } = await import("../src/utils/supabase/client");
    expect(createClient()).toBe(createClient());
    expect(mocks.create).toHaveBeenCalledOnce();
    const options = mocks.create.mock.calls[0][2];
    expect(options?.auth).toEqual({ detectSessionInUrl: false });
  });
});
