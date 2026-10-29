import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("../server/supabase/adminClient", () => mocks);
import {
  consumeGoogleOAuthState,
  updateGoogleSubscription,
  persistGoogleCalendarConnection,
} from "../server/googleCalendarRepository";

describe("Google OAuth state claim", () => {
  beforeEach(() => vi.resetAllMocks());
  it("fences callback failure updates by generation and current lifecycle", async () => {
    const query = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      neq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: { id: "sub" }, error: null })),
    };
    mocks.createSupabaseAdminClient.mockReturnValue({ from: () => query });
    await updateGoogleSubscription({
      subscriptionId: "sub",
      status: "failed",
      connectionGeneration: 7,
      env: {},
    });
    expect(query.eq).toHaveBeenCalledWith("google_connection_generation", 7);
    expect(query.neq).toHaveBeenCalledWith("status", "disconnected");
    expect(query.is).toHaveBeenCalledWith("revoked_at", null);
  });

  it("reports a rejected filtered subscription write", async () => {
    const query = {
      update: vi.fn(() => query),
      eq: vi.fn(() => query),
      neq: vi.fn(() => query),
      is: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    mocks.createSupabaseAdminClient.mockReturnValue({ from: () => query });
    expect(
      await updateGoogleSubscription({
        subscriptionId: "sub",
        connectionGeneration: 7,
        status: "active",
        env: {},
      }),
    ).toBe(false);
  });

  it("uses the atomic credential/pending RPC and rejects a lost generation", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: false, error: null });
    mocks.createSupabaseAdminClient.mockReturnValue({ rpc });
    await expect(
      persistGoogleCalendarConnection({
        subscriptionId: "sub",
        connectionGeneration: 7,
        encryptedRefreshToken: "synthetic-ciphertext",
        grantedScope: "scope",
        env: {},
      }),
    ).rejects.toMatchObject({ code: "SUBSCRIPTION_DISCONNECTED" });
    expect(rpc).toHaveBeenCalledWith("complete_google_calendar_connection", {
      p_subscription_id: "sub",
      p_generation: 7,
      p_encrypted_refresh_token: "synthetic-ciphertext",
      p_granted_scope: "scope",
    });
  });
  it("uses DELETE RETURNING so only one concurrent consumer obtains the state", async () => {
    let available = true;
    const query = {
      delete: vi.fn(() => query),
      eq: vi.fn(() => query),
      select: vi.fn(() => query),
      maybeSingle: vi.fn(async () => {
        const data = available
          ? {
              state_hash: "hash",
              subscription_id: "sub",
              expires_at: "2099-01-01",
            }
          : null;
        available = false;
        return { data, error: null };
      }),
    };
    const from = vi.fn(() => query);
    mocks.createSupabaseAdminClient.mockReturnValue({ from });
    const env = { SUPABASE_URL: "https://example.invalid" };
    const results = await Promise.all([
      consumeGoogleOAuthState({ stateHash: "hash", env }),
      consumeGoogleOAuthState({ stateHash: "hash", env }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(from).toHaveBeenCalledTimes(2);
    expect(query.delete).toHaveBeenCalledTimes(2);
    expect(query.select).toHaveBeenCalledWith(
      "state_hash, subscription_id, expires_at, connection_generation, anonymous_session_id",
    );
    expect(query.delete.mock.invocationCallOrder[0]).toBeLessThan(
      query.select.mock.invocationCallOrder[0],
    );
    expect(mocks.createSupabaseAdminClient).toHaveBeenCalledWith(env);
  });
});
