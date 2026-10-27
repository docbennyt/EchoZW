import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const QA_TIMETABLE = "1a641bbb-856e-49b7-8fba-b20a17febf5f";
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const isUuid = (value) => typeof value === "string" && UUID.test(value);
const invalid = () => new Error("TRUSTED_CANARY_SCOPE_INVALID");

export function prepareCanarySecrets(
  raw,
  candidateSha,
  selectedBindingPresent,
  now = Date.now(),
) {
  if (raw === "") return { GOOGLE_CANARY_EXPIRES_AT: "" };
  try {
    if (typeof raw !== "string" || raw.length > 2048) throw invalid();
    const scope = JSON.parse(raw);
    const allowed = [
      "candidateSha",
      "ownerId",
      "timetableId",
      "expiresAt",
      "subscriptionId",
    ];
    if (
      !scope ||
      Array.isArray(scope) ||
      typeof scope !== "object" ||
      Object.keys(scope).some((key) => !allowed.includes(key))
    )
      throw invalid();
    const expiry = Date.parse(scope.expiresAt);
    if (
      !/^[a-f0-9]{40}$/.test(candidateSha ?? "") ||
      scope.candidateSha !== candidateSha ||
      !isUuid(scope.ownerId) ||
      scope.timetableId !== QA_TIMETABLE ||
      typeof scope.expiresAt !== "string" ||
      !Number.isFinite(expiry) ||
      expiry <= now ||
      expiry - now > 86400000
    )
      throw invalid();
    const selected = Object.hasOwn(scope, "subscriptionId");
    if (selected ? !isUuid(scope.subscriptionId) : selectedBindingPresent)
      throw invalid();
    return {
      GOOGLE_CANARY_OWNER_ID: scope.ownerId,
      GOOGLE_CANARY_TIMETABLE_ID: scope.timetableId,
      GOOGLE_CANARY_EXPIRES_AT: scope.expiresAt,
      ...(selected
        ? { GOOGLE_CANARY_SUBSCRIPTION_ID: scope.subscriptionId }
        : {}),
    };
  } catch {
    throw invalid();
  }
}

export async function selectedCanaryBindingPresent(env, request = fetch) {
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("TRUSTED_CANARY_SETTINGS_UNAVAILABLE");
  const response = await request(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-staging/settings`,
    {
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("TRUSTED_CANARY_SETTINGS_UNAVAILABLE");
  const body = await response.json();
  if (body.success !== true || !Array.isArray(body.result?.bindings))
    throw new Error("TRUSTED_CANARY_SETTINGS_UNAVAILABLE");
  return body.result.bindings.some(
    (binding) => binding.name === "GOOGLE_CANARY_SUBSCRIPTION_ID",
  );
}

async function main() {
  const raw = process.env.CALENDERZW_STAGING_GOOGLE_CANARY ?? "";
  // Validate before any network call. A bootstrap may not inherit an old selection.
  const bindings = prepareCanarySecrets(raw, process.env.CANDIDATE_SHA, false);
  if (raw && !Object.hasOwn(bindings, "GOOGLE_CANARY_SUBSCRIPTION_ID")) {
    prepareCanarySecrets(
      raw,
      process.env.CANDIDATE_SHA,
      await selectedCanaryBindingPresent(process.env),
    );
  }
  writeFileSync("staging-canary-secrets.json", JSON.stringify(bindings), {
    mode: 0o600,
    flag: "wx",
  });
  console.log(
    raw
      ? "Prepared expiring isolated QA canary bindings"
      : "Prepared disabled canary scope",
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error("TRUSTED_CANARY_PREPARATION_FAILED");
    process.exitCode = 1;
  });
}
