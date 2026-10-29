import { describe, expect, it, vi } from "vitest";
import { encryptGoogleRefreshToken } from "../server/googleCalendarSync";
import { recoverGoogleCredentialEncryption } from "../server/googleCredentialRecovery";

const currentKey = "current-test-key";
const legacyKey = "legacy-test-key";
const sha = "a".repeat(40);
const now = Date.parse("2026-10-29T08:00:00Z");
const row = (
  id: number,
  token: string,
  key: "legacy" | "current" | "other",
) => ({
  subscription_id: `10000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
  encrypted_refresh_token: encryptGoogleRefreshToken(token, {
    TOKEN_ENCRYPTION_KEY:
      key === "legacy"
        ? legacyKey
        : key === "current"
          ? currentKey
          : "other-key",
  }),
  created_at: new Date(now + id * 1000).toISOString(),
  updated_at: new Date(now + id * 1000).toISOString(),
});
const env = (
  mode: "compatibility" | "migrate",
  keySource: "railway" | "historical2" = "railway",
) =>
  ({
    APP_ENV: "cloudflare-staging",
    SOURCE_SHA: sha,
    TOKEN_ENCRYPTION_KEY: currentKey,
    LEGACY_TOKEN_ENCRYPTION_KEY: legacyKey,
    GOOGLE_CREDENTIAL_RECOVERY_SCOPE: JSON.stringify({
      candidateSha: sha,
      expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
      mode,
      keySource,
    }),
  }) as NodeJS.ProcessEnv;

function repository(rows: ReturnType<typeof row>[]) {
  const stored = new Map(
    rows.map((item) => [item.subscription_id, { ...item }]),
  );
  return {
    stored,
    list: vi.fn(async () => [...stored.values()]),
    get: vi.fn(async (id: string) => stored.get(id) ?? null),
    begin: vi.fn(
      async ({ subscriptionId, expectedCiphertext, newCiphertext }) => {
        const item = stored.get(subscriptionId);
        if (!item || item.encrypted_refresh_token !== expectedCiphertext)
          return false;
        item.encrypted_refresh_token = newCiphertext;
        return true;
      },
    ),
    verify: vi.fn(async () => true),
    revert: vi.fn(async () => true),
  };
}

describe("protected legacy credential compatibility", () => {
  it("fails closed outside staging or without an exact unexpired scope", async () => {
    const repo = repository([row(1, "one", "legacy")]);
    for (const changed of [
      { APP_ENV: "production" },
      { LEGACY_TOKEN_ENCRYPTION_KEY: "" },
      { SOURCE_SHA: "b".repeat(40) },
      {
        GOOGLE_CREDENTIAL_RECOVERY_SCOPE: JSON.stringify({
          candidateSha: sha,
          expiresAt: new Date(now - 1).toISOString(),
          mode: "compatibility",
          keySource: "railway",
        }),
      },
      {
        GOOGLE_CREDENTIAL_RECOVERY_SCOPE: JSON.stringify({
          candidateSha: sha,
          expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
          mode: "compatibility",
          keySource: "unknown",
        }),
      },
    ]) {
      await expect(
        recoverGoogleCredentialEncryption(
          "compatibility",
          { ...env("compatibility"), ...changed },
          repo,
          now,
        ),
      ).rejects.toThrow("Google credential recovery is unavailable");
    }
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("rejects a historical2 migration before reading credentials", async () => {
    const repo = repository([row(1, "one", "legacy")]);
    await expect(
      recoverGoogleCredentialEncryption(
        "migrate",
        env("migrate", "historical2"),
        repo,
        now,
      ),
    ).rejects.toThrow("Google credential recovery is unavailable");
    expect(repo.list).not.toHaveBeenCalled();
  });

  it("counts compatible records even when the oldest needs another historical key", async () => {
    const repo = repository([
      row(1, "oldest", "other"),
      row(2, "later", "legacy"),
    ]);
    const report = await recoverGoogleCredentialEncryption(
      "compatibility",
      env("compatibility"),
      repo,
      now,
    );
    expect(report).toMatchObject({
      totalCredentials: 2,
      legacyDecryptionSuccessful: true,
      oldestCredentialLegacyCompatible: false,
      decryptableWithLegacyKey: 1,
      needingAnotherHistoricalKey: 1,
      migratedAndVerified: 0,
    });
    expect(repo.begin).not.toHaveBeenCalled();
  });

  it("reports zero legacy matches without mutating credentials and blocks migration", async () => {
    const repo = repository([
      row(1, "oldest", "other"),
      row(2, "current", "current"),
    ]);
    const report = await recoverGoogleCredentialEncryption(
      "compatibility",
      env("compatibility"),
      repo,
      now,
    );
    expect(report).toMatchObject({
      legacyDecryptionSuccessful: false,
      oldestCredentialLegacyCompatible: false,
      decryptableWithLegacyKey: 0,
      decryptableWithCurrentKey: 1,
      needingAnotherHistoricalKey: 1,
      migratedAndVerified: 0,
    });
    await expect(
      recoverGoogleCredentialEncryption("migrate", env("migrate"), repo, now),
    ).rejects.toMatchObject({ code: "GOOGLE_LEGACY_KEY_NOT_COMPATIBLE" });
    expect(repo.begin).not.toHaveBeenCalled();
  });

  it("reports legacy, current and neither counts without returning sensitive material", async () => {
    const repo = repository([
      row(1, "legacy-one", "legacy"),
      row(2, "legacy-two", "legacy"),
      row(3, "current", "current"),
      row(4, "unknown", "other"),
    ]);
    const report = await recoverGoogleCredentialEncryption(
      "compatibility",
      env("compatibility"),
      repo,
      now,
    );
    expect(report).toEqual({
      legacyDecryptionSuccessful: true,
      oldestCredentialLegacyCompatible: true,
      totalCredentials: 4,
      decryptableWithLegacyKey: 2,
      decryptableWithCurrentKey: 1,
      decryptableWithBothKeys: 0,
      needingAnotherHistoricalKey: 1,
      migratedAndVerified: 0,
      concurrentUpdatesSkipped: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(/legacy-one|legacy-two|v1\./);
  });

  it("migrates only legacy-only credentials and verifies each current-key ciphertext", async () => {
    const legacyRow = row(1, "legacy-one", "legacy");
    const repo = repository([
      legacyRow,
      row(2, "current", "current"),
      row(3, "unknown", "other"),
    ]);
    const report = await recoverGoogleCredentialEncryption(
      "migrate",
      env("migrate"),
      repo,
      now,
    );
    expect(report.migratedAndVerified).toBe(1);
    expect(repo.begin).toHaveBeenCalledTimes(1);
    expect(repo.verify).toHaveBeenCalledTimes(1);
    expect(repo.revert).not.toHaveBeenCalled();
    expect(repo.begin.mock.calls[0][0]).toMatchObject({
      subscriptionId: legacyRow.subscription_id,
      expectedCiphertext: legacyRow.encrypted_refresh_token,
    });
    expect(repo.begin.mock.calls[0][0].newCiphertext).not.toBe(
      legacyRow.encrypted_refresh_token,
    );
  });

  it("migrates only individually authenticated legacy rows even when oldest cannot decrypt", async () => {
    const repo = repository([
      row(1, "older-key", "other"),
      row(2, "recoverable", "legacy"),
      row(3, "current", "current"),
    ]);
    const report = await recoverGoogleCredentialEncryption(
      "migrate",
      env("migrate"),
      repo,
      now,
    );
    expect(report).toMatchObject({
      oldestCredentialLegacyCompatible: false,
      decryptableWithLegacyKey: 1,
      needingAnotherHistoricalKey: 1,
      migratedAndVerified: 1,
    });
    expect(repo.begin).toHaveBeenCalledTimes(1);
    expect(repo.verify).toHaveBeenCalledTimes(1);
  });

  it("does not record success when compare-and-swap loses a concurrent update", async () => {
    const repo = repository([row(1, "legacy-one", "legacy")]);
    repo.begin.mockResolvedValue(false);
    const report = await recoverGoogleCredentialEncryption(
      "migrate",
      env("migrate"),
      repo,
      now,
    );
    expect(report.migratedAndVerified).toBe(0);
    expect(report.concurrentUpdatesSkipped).toBe(1);
    expect(repo.verify).not.toHaveBeenCalled();
  });
});
