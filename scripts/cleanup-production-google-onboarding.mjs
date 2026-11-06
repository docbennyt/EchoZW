import { setTimeout as delay } from "node:timers/promises";

export async function cleanupProductionGoogleOnboarding(env, request = fetch) {
  if (
    env.GITHUB_REF !== "refs/heads/Calender" ||
    !/^[a-f0-9]{40}$/.test(env.SOURCE_SHA ?? "") ||
    !/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? "") ||
    !env.CLOUDFLARE_API_TOKEN
  )
    throw new Error("GOOGLE_ONBOARDING_CLEANUP_CONFIG_INVALID");
  const root =
    "https://api.cloudflare.com/client/v4/accounts/" +
    env.CLOUDFLARE_ACCOUNT_ID +
    "/workers/scripts/calenderzw-edge-production";
  const api = async (method, path) => {
    const response = await request(root + path, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN },
    });
    const body = await response.json();
    if (!response.ok || body.success !== true)
      throw new Error("GOOGLE_ONBOARDING_CLEANUP_OPERATION_FAILED");
    return body.result;
  };
  const assertBindings = (bindings) => {
    if (
      !Array.isArray(bindings) ||
      !bindings.some(
        (b) => b.name === "SOURCE_SHA" && b.text === env.SOURCE_SHA,
      ) ||
      !bindings.some(
        (b) => b.name === "APP_ENV" && b.text === "cloudflare-production",
      ) ||
      !bindings.some(
        (b) => b.name === "ENABLE_GOOGLE_DELIVERY" && b.text === "false",
      )
    )
      throw new Error("GOOGLE_ONBOARDING_CLEANUP_RELEASE_MISMATCH");
  };
  const settings = await api("GET", "/settings");
  assertBindings(settings.bindings);
  const alreadyAbsent = !settings.bindings.some(
    (b) => b.name === "GOOGLE_PRODUCTION_ONBOARDING",
  );
  if (!alreadyAbsent)
    await api("DELETE", "/secrets/GOOGLE_PRODUCTION_ONBOARDING");
  for (let attempt = 0; attempt < 5; attempt++) {
    const deployments = await api("GET", "/deployments");
    const deployment = (deployments.deployments ?? deployments)[0];
    if (
      deployment?.versions?.length === 1 &&
      deployment.versions[0].percentage === 100
    ) {
      const version = deployment.versions[0].version_id;
      const value = await api("GET", "/versions/" + version);
      const bindings = value.resources?.bindings;
      assertBindings(bindings);
      if (!bindings.some((b) => b.name === "GOOGLE_PRODUCTION_ONBOARDING")) {
        const response = await request(
          "https://backend.calender.aido.co.zw/__release",
          {
            redirect: "error",
            signal: AbortSignal.timeout(15000),
          },
        );
        const identity = await response.json();
        if (
          response.ok &&
          identity.sourceSha === env.SOURCE_SHA &&
          identity.workerVersion === version &&
          identity.stage === "cloudflare-production"
        )
          return {
            removed: true,
            workerVersion: version,
            ...(alreadyAbsent ? { alreadyAbsent: true } : {}),
          };
      }
    }
    await delay(2000);
  }
  throw new Error("GOOGLE_ONBOARDING_CLEANUP_PROPAGATION_UNVERIFIED");
}
if (process.argv[1]?.endsWith("cleanup-production-google-onboarding.mjs")) {
  try {
    console.log(
      JSON.stringify(await cleanupProductionGoogleOnboarding(process.env)),
    );
  } catch {
    console.error("GOOGLE_ONBOARDING_CLEANUP_FAILED");
    process.exitCode = 1;
  }
}
