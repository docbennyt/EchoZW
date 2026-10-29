import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}

export function sameReviewedResources(reviewed, active) {
  const temporaryRecoveryBindings = new Set([
    "GOOGLE_RECOVERY_CANARY",
    "GOOGLE_CREDENTIAL_RECOVERY_SCOPE",
    "LEGACY_TOKEN_ENCRYPTION_KEY",
  ]);
  const bindings = (value) =>
    value?.bindings
      ?.filter((b) => !temporaryRecoveryBindings.has(b.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  return Boolean(
    reviewed?.script?.etag &&
    reviewed.script.etag === active?.script?.etag &&
    Array.isArray(reviewed.bindings) &&
    Array.isArray(active.bindings) &&
    JSON.stringify(canonical(reviewed.script_runtime)) ===
      JSON.stringify(canonical(active.script_runtime)) &&
    JSON.stringify(canonical(bindings(reviewed))) ===
      JSON.stringify(canonical(bindings(active))),
  );
}

export async function verifyRecoveryWorker(env, request = fetch) {
  const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
  if (
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN ||
    !uuid.test(env.REVIEWED_WORKER_VERSION ?? "")
  )
    throw new Error("RECOVERY_PROVENANCE_CONFIG_INVALID");
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-staging`;
  const read = async (path) => {
    const r = await request(base + path, {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    });
    const j = await r.json();
    if (!r.ok || j.success !== true)
      throw new Error("RECOVERY_PROVENANCE_LOOKUP_FAILED");
    return j.result;
  };
  const active = await read("/deployments");
  const deployment = (active.deployments ?? active)?.[0];
  const versions = deployment?.versions;
  if (
    versions?.length !== 1 ||
    versions[0].percentage !== 100 ||
    !uuid.test(versions[0].version_id)
  )
    throw new Error("RECOVERY_ACTIVE_VERSION_INVALID");
  const version = versions[0].version_id;
  if (version !== env.REVIEWED_WORKER_VERSION) {
    const [reviewed, current] = await Promise.all([
      read(`/versions/${env.REVIEWED_WORKER_VERSION}`),
      read(`/versions/${version}`),
    ]);
    if (!sameReviewedResources(reviewed.resources, current.resources))
      throw new Error("RECOVERY_VERSION_RESOURCES_CHANGED");
  }
  return version;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const version = await verifyRecoveryWorker(process.env);
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(
    `Verified reviewed script and active recovery configuration: ${version}`,
  );
}
