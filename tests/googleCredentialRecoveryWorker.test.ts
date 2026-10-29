// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  recover: vi.fn(),
}));
vi.mock("../server/supabase/auth.ts", async (original) => ({
  ...(await original<typeof import("../server/supabase/auth.ts")>()),
  requireOperationalAdmin: mocks.guard,
}));
vi.mock("../server/googleCredentialRecovery.ts", () => ({
  recoverGoogleCredentialEncryption: mocks.recover,
}));
import { handleGoogleCredentialRecovery } from "../worker/googleCredentialRecoveryApi.mjs";

const env = { APP_ENV: "cloudflare-staging" };
function request(body: unknown, headers = {}) {
  return new Request(
    "https://next.calender.aido.co.zw/api/admin/google-credential-recovery",
    {
      method: "POST",
      headers: {
        authorization: "Bearer protected-admin",
        origin: "https://next.calender.aido.co.zw",
        "content-type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    },
  );
}

describe("protected credential recovery Worker route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.guard.mockResolvedValue({ user: { id: "operator" } });
    mocks.recover.mockResolvedValue({
      legacyDecryptionSuccessful: true,
      decryptableWithLegacyKey: 74,
      decryptableWithCurrentKey: 0,
      needingAnotherHistoricalKey: 0,
      migratedAndVerified: 0,
    });
  });

  it("ignores unrelated routes", async () => {
    expect(
      await handleGoogleCredentialRecovery(
        new Request("https://next.calender.aido.co.zw/api/admin/session"),
        env,
      ),
    ).toBeNull();
  });

  it("requires same-origin operational admin authorization", async () => {
    const denied = await handleGoogleCredentialRecovery(
      request(
        { mode: "compatibility" },
        { origin: "https://attacker.invalid" },
      ),
      env,
    );
    expect(denied?.status).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.recover).not.toHaveBeenCalled();
  });

  it.each(["compatibility", "migrate"])(
    "runs only the strict protected %s operation",
    async (mode) => {
      const response = await handleGoogleCredentialRecovery(
        request({ mode }),
        env,
      );
      expect(response?.status).toBe(200);
      expect(response?.headers.get("cache-control")).toBe("no-store");
      expect(mocks.guard).toHaveBeenCalled();
      expect(mocks.recover).toHaveBeenCalledWith(mode, env);
      expect(await response!.json()).toMatchObject({
        credentialRecovery: { legacyDecryptionSuccessful: true },
      });
    },
  );

  it("rejects extra control fields", async () => {
    const response = await handleGoogleCredentialRecovery(
      request({ mode: "migrate", subscriptionId: "attacker-selected" }),
      env,
    );
    expect(response?.status).toBe(422);
    expect(mocks.recover).not.toHaveBeenCalled();
  });
});
