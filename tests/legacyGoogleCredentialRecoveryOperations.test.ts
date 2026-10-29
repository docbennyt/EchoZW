// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  provenance: vi.fn(),
  token: vi.fn(),
}));
vi.mock("../scripts/verify-staging-identity.mjs", () => ({
  verifyStagingIdentity: mocks.identity,
}));
vi.mock("../scripts/verify-recovery-worker.mjs", () => ({
  verifyRecoveryWorker: mocks.provenance,
}));
vi.mock("../scripts/recovery-acceptance.mjs", () => ({
  obtainAcceptanceToken: mocks.token,
}));
import { runLegacyGoogleCredentialRecovery } from "../scripts/recover-legacy-google-credentials.mjs";

const sha = "a".repeat(40);
const env = () => ({
  GITHUB_REF: "refs/heads/Calender",
  EXPECTED_RELEASE_SHA: sha,
  EXPECTED_WORKER_VERSION: "10000000-0000-4000-8000-000000000001",
  CREDENTIAL_RECOVERY_MODE: "compatibility",
  CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY: "private-legacy-key",
  CLOUDFLARE_ACCOUNT_ID: "f".repeat(32),
  CLOUDFLARE_API_TOKEN: "private-cloudflare-token",
});

function provider() {
  const bindings = new Map<string, Record<string, string>>([
    ["SOURCE_SHA", { name: "SOURCE_SHA", type: "plain_text", text: sha }],
    [
      "ENABLE_GOOGLE_DELIVERY",
      { name: "ENABLE_GOOGLE_DELIVERY", type: "plain_text", text: "false" },
    ],
    [
      "TOKEN_ENCRYPTION_KEY",
      { name: "TOKEN_ENCRYPTION_KEY", type: "secret_text" },
    ],
  ]);
  return vi.fn(
    async (url: Parameters<typeof fetch>[0], init: RequestInit = {}) => {
      const target = new URL(String(url));
      if (target.origin === "https://api.cloudflare.com") {
        if (init.method === "PUT") {
          const body = JSON.parse(String(init.body));
          bindings.set(body.name, { name: body.name, type: body.type });
        }
        if (init.method === "DELETE")
          bindings.delete(target.pathname.split("/").at(-1)!);
        const result = target.pathname.endsWith("/settings")
          ? { bindings: [...bindings.values()] }
          : target.pathname.endsWith("/deployments")
            ? {
                deployments: [
                  {
                    versions: [
                      {
                        version_id: "20000000-0000-4000-8000-000000000001",
                        percentage: 100,
                      },
                    ],
                  },
                ],
              }
            : {};
        return Response.json({ success: true, result });
      }
      expect(target.href).toBe(
        "https://next.calender.aido.co.zw/api/admin/google-credential-recovery",
      );
      expect(init.redirect).toBe("error");
      expect(JSON.parse(String(init.body))).toEqual({ mode: "compatibility" });
      expect(bindings.has("LEGACY_TOKEN_ENCRYPTION_KEY")).toBe(true);
      expect(bindings.has("GOOGLE_CREDENTIAL_RECOVERY_SCOPE")).toBe(true);
      return Response.json({
        credentialRecovery: {
          legacyDecryptionSuccessful: true,
          totalCredentials: 74,
          decryptableWithLegacyKey: 71,
          decryptableWithCurrentKey: 3,
          decryptableWithBothKeys: 0,
          needingAnotherHistoricalKey: 0,
          migratedAndVerified: 0,
          concurrentUpdatesSkipped: 0,
        },
      });
    },
  );
}

describe("protected legacy-key operation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.identity.mockResolvedValue({ sourceSha: sha });
    mocks.provenance.mockResolvedValue("20000000-0000-4000-8000-000000000001");
    mocks.token.mockResolvedValue("private-admin-token");
  });

  it("adds only temporary bindings, returns counts and always removes them", async () => {
    const request = provider();
    const report = await runLegacyGoogleCredentialRecovery(env(), { request });
    expect(report).toMatchObject({
      legacyDecryptionSuccessful: true,
      decryptableWithLegacyKey: 71,
      decryptableWithCurrentKey: 3,
      needingAnotherHistoricalKey: 0,
      migratedAndVerified: 0,
      temporaryRecoveryBindingsAbsent: true,
    });
    const writes = request.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    const deletes = request.mock.calls.filter(
      ([, init]) => init?.method === "DELETE",
    );
    expect(writes).toHaveLength(2);
    expect(deletes).toHaveLength(2);
    expect(JSON.stringify(report)).not.toMatch(
      /private-legacy|private-cloudflare|private-admin/,
    );
  });

  it("tries every temporary-secret deletion even after failures", async () => {
    const base = provider();
    const deletions: string[] = [];
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const [url, init] = args;
      if (init?.method === "DELETE") {
        deletions.push(String(url));
        if (String(url).endsWith("/GOOGLE_CREDENTIAL_RECOVERY_SCOPE"))
          return Response.json({ success: false }, { status: 503 });
      }
      return base(...args);
    });
    await expect(
      runLegacyGoogleCredentialRecovery(env(), { request }),
    ).rejects.toThrow("RECOVERY_DISABLE_NOT_CONFIRMED");
    expect(deletions).toHaveLength(4);
    expect(deletions.join(" ")).toContain("LEGACY_TOKEN_ENCRYPTION_KEY");
    expect(deletions.join(" ")).toContain("GOOGLE_CREDENTIAL_RECOVERY_SCOPE");
  });

  it("fails before configuration writes when the legacy key is unavailable", async () => {
    const request = provider();
    await expect(
      runLegacyGoogleCredentialRecovery(
        { ...env(), CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY: "" },
        { request },
      ),
    ).rejects.toThrow("LEGACY_TOKEN_ENCRYPTION_KEY_REQUIRED");
    expect(request).not.toHaveBeenCalled();
  });

  it("attempts removal of both bindings when provisioning is interrupted", async () => {
    const base = provider();
    let puts = 0;
    const request = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const init = args[1];
      if (init?.method === "PUT" && ++puts === 2)
        return Response.json(
          { success: false, errors: [{ code: 10000 }] },
          { status: 403 },
        );
      return base(...args);
    });
    await expect(
      runLegacyGoogleCredentialRecovery(env(), { request }),
    ).rejects.toThrow("RECOVERY_CONFIGURATION_OPERATION_FAILED");
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(2);
  });
});
