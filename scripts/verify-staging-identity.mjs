import { appendFileSync } from "node:fs";

export async function verifyStagingIdentity(env, request = fetch) {
  const response = await request("https://next.calender.aido.co.zw/__release", {
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { "cache-control": "no-cache" },
  });
  const release = response.ok ? await response.json() : null;
  if (
    !/^[a-f0-9]{40}$/.test(env.EXPECTED_RELEASE_SHA ?? "") ||
    release?.sourceSha !== env.EXPECTED_RELEASE_SHA ||
    release.runtime !== "cloudflare-workers" ||
    release.legacyBackendBridge !== false ||
    !env.EXPECTED_WORKER_VERSION ||
    release.workerVersion !== env.EXPECTED_WORKER_VERSION
  )
    throw new Error("STAGING_IDENTITY_MISMATCH_AUTHENTICATION_BLOCKED");
  return release;
}

if (process.argv[1]?.endsWith("verify-staging-identity.mjs")) {
  const release = await verifyStagingIdentity(process.env);
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `version=${release.workerVersion}\n`,
    );
  console.log(
    `Verified staging release ${release.sourceSha}, Worker ${release.workerVersion}`,
  );
}
