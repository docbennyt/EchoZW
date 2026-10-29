import { randomUUID, timingSafeEqual } from "node:crypto";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
} from "./googleCalendarSync.js";
import {
  beginGoogleCredentialKeyMigration,
  getGoogleCredential,
  listGoogleCredentials,
  revertGoogleCredentialKeyMigration,
  verifyGoogleCredentialKeyMigration,
} from "./googleCalendarRepository.js";
import { PilotApiError } from "./pilotRepository.js";

type RecoveryMode = "compatibility" | "migrate";
type JsonRecord = Record<string, unknown>;

type RecoveryRepository = {
  list: typeof listGoogleCredentials;
  get: typeof getGoogleCredential;
  begin: typeof beginGoogleCredentialKeyMigration;
  verify: typeof verifyGoogleCredentialKeyMigration;
  revert: typeof revertGoogleCredentialKeyMigration;
};

const defaultRepository: RecoveryRepository = {
  list: listGoogleCredentials,
  get: getGoogleCredential,
  begin: beginGoogleCredentialKeyMigration,
  verify: verifyGoogleCredentialKeyMigration,
  revert: revertGoogleCredentialKeyMigration,
};

function unavailable(code = "GOOGLE_CREDENTIAL_RECOVERY_UNAVAILABLE") {
  return new PilotApiError(
    code,
    "Google credential recovery is unavailable.",
    503,
  );
}

function recoveryScope(
  requestedMode: RecoveryMode,
  env: NodeJS.ProcessEnv,
  now: number,
) {
  try {
    const scope = JSON.parse(
      env.GOOGLE_CREDENTIAL_RECOVERY_SCOPE ?? "",
    ) as JsonRecord;
    const expiry = Date.parse(String(scope.expiresAt ?? ""));
    const keySource = String(scope.keySource ?? "");
    if (
      env.APP_ENV !== "cloudflare-staging" ||
      !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA ?? "") ||
      scope.candidateSha !== env.SOURCE_SHA ||
      scope.mode !== requestedMode ||
      !["railway", "historical2"].includes(keySource) ||
      (keySource === "historical2" && requestedMode !== "compatibility") ||
      !Number.isFinite(expiry) ||
      expiry <= now ||
      expiry - now > 60 * 60 * 1000 ||
      !env.TOKEN_ENCRYPTION_KEY?.trim() ||
      !env.LEGACY_TOKEN_ENCRYPTION_KEY?.trim()
    ) {
      throw new Error();
    }
    return scope;
  } catch {
    throw unavailable();
  }
}

function decryptOrNull(ciphertext: string, key: string) {
  try {
    return decryptGoogleRefreshToken(ciphertext, {
      TOKEN_ENCRYPTION_KEY: key,
    });
  } catch {
    return null;
  }
}

function sameSecret(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function credentialFields(row: JsonRecord) {
  const subscriptionId = String(row.subscription_id ?? "");
  const ciphertext = String(row.encrypted_refresh_token ?? "");
  if (!/^[a-f0-9-]{36}$/i.test(subscriptionId) || !ciphertext) {
    throw unavailable("GOOGLE_CREDENTIAL_RECORD_INVALID");
  }
  return { subscriptionId, ciphertext };
}

export async function recoverGoogleCredentialEncryption(
  mode: RecoveryMode,
  env: NodeJS.ProcessEnv = process.env,
  repository: RecoveryRepository = defaultRepository,
  now = Date.now(),
) {
  recoveryScope(mode, env, now);
  const currentKey = env.TOKEN_ENCRYPTION_KEY!.trim();
  const legacyKey = env.LEGACY_TOKEN_ENCRYPTION_KEY!.trim();
  const rows = (await repository.list(env)).sort((left, right) =>
    `${left.created_at ?? ""}:${left.subscription_id ?? ""}`.localeCompare(
      `${right.created_at ?? ""}:${right.subscription_id ?? ""}`,
    ),
  );
  if (!rows.length) throw unavailable("GOOGLE_CREDENTIALS_NOT_FOUND");

  // Classify every credential: the oldest record may predate the recovered
  // Railway key or have been encrypted under another historical key.
  // A mismatch on that single row is not proof that all rows are incompatible.
  const classified = rows.map((row) => {
    const fields = credentialFields(row);
    return {
      ...fields,
      legacyToken: decryptOrNull(fields.ciphertext, legacyKey),
      currentToken: decryptOrNull(fields.ciphertext, currentKey),
    };
  });
  const legacyMatchCount = classified.filter((item) => item.legacyToken).length;
  const report = {
    legacyDecryptionSuccessful: legacyMatchCount > 0,
    oldestCredentialLegacyCompatible: Boolean(classified[0].legacyToken),
    totalCredentials: classified.length,
    decryptableWithLegacyKey: legacyMatchCount,
    decryptableWithCurrentKey: classified.filter((item) => item.currentToken)
      .length,
    decryptableWithBothKeys: classified.filter(
      (item) => item.legacyToken && item.currentToken,
    ).length,
    needingAnotherHistoricalKey: classified.filter(
      (item) => !item.legacyToken && !item.currentToken,
    ).length,
    migratedAndVerified: 0,
    concurrentUpdatesSkipped: 0,
  };
  if (mode === "compatibility") return report;
  if (legacyMatchCount === 0)
    throw unavailable("GOOGLE_LEGACY_KEY_NOT_COMPATIBLE");

  for (const item of classified) {
    if (!item.legacyToken || item.currentToken) continue;
    const migrationId = randomUUID();
    const newCiphertext = encryptGoogleRefreshToken(item.legacyToken, env);
    const locallyVerified = decryptOrNull(newCiphertext, currentKey);
    if (!locallyVerified || !sameSecret(locallyVerified, item.legacyToken)) {
      throw unavailable("GOOGLE_CREDENTIAL_REENCRYPTION_FAILED");
    }
    const swapped = await repository.begin({
      subscriptionId: item.subscriptionId,
      expectedCiphertext: item.ciphertext,
      newCiphertext,
      migrationId,
      env,
    });
    if (!swapped) {
      report.concurrentUpdatesSkipped += 1;
      continue;
    }
    const stored = await repository.get(item.subscriptionId, env);
    const storedCiphertext = String(stored?.encrypted_refresh_token ?? "");
    const storedToken = decryptOrNull(storedCiphertext, currentKey);
    if (
      storedCiphertext !== newCiphertext ||
      !storedToken ||
      !sameSecret(storedToken, item.legacyToken)
    ) {
      await repository.revert({
        subscriptionId: item.subscriptionId,
        expectedCiphertext: newCiphertext,
        migrationId,
        env,
      });
      throw unavailable("GOOGLE_CREDENTIAL_MIGRATION_VERIFY_FAILED");
    }
    const recorded = await repository.verify({
      subscriptionId: item.subscriptionId,
      expectedCiphertext: newCiphertext,
      migrationId,
      env,
    });
    if (!recorded) {
      await repository.revert({
        subscriptionId: item.subscriptionId,
        expectedCiphertext: newCiphertext,
        migrationId,
        env,
      });
      throw unavailable("GOOGLE_CREDENTIAL_MIGRATION_AUDIT_FAILED");
    }
    report.migratedAndVerified += 1;
  }
  return report;
}
