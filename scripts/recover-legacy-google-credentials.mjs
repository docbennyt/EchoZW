import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { obtainAcceptanceToken } from "./recovery-acceptance.mjs";
import { verifyRecoveryWorker } from "./verify-recovery-worker.mjs";
import { verifyStagingIdentity } from "./verify-staging-identity.mjs";

const origin = "https://next.calender.aido.co.zw";
const temporaryBindings = [
  "GOOGLE_CREDENTIAL_RECOVERY_SCOPE",
  "LEGACY_TOKEN_ENCRYPTION_KEY",
];
const fail = (code) => {
  throw new Error(code);
};

export async function runLegacyGoogleCredentialRecovery(
  env,
  dependencies = {},
) {
  const request = dependencies.request ?? fetch;
  const pause =
    dependencies.pause ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const mode = env.CREDENTIAL_RECOVERY_MODE;
  if (!["compatibility", "migrate"].includes(mode))
    fail("RECOVERY_MODE_INVALID");
  if (env.GITHUB_REF !== "refs/heads/Calender")
    fail("TRUSTED_WORKFLOW_BRANCH_REQUIRED");
  if (!env.CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY)
    fail("LEGACY_TOKEN_ENCRYPTION_KEY_REQUIRED");
  const initial = await verifyStagingIdentity(env, request);
  await verifyRecoveryWorker(
    { ...env, REVIEWED_WORKER_VERSION: env.EXPECTED_WORKER_VERSION },
    request,
  );

  const cf = async (method, suffix, body, allowNotFound = false) => {
    if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? ""))
      fail("CLOUDFLARE_ACCOUNT_INVALID");
    if (!env.CLOUDFLARE_API_TOKEN) fail("CLOUDFLARE_AUTH_REQUIRED");
    const response = await request(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-staging${suffix}`,
      {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    );
    const value = await response.json();
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok || value.success !== true)
      fail("RECOVERY_CONFIGURATION_OPERATION_FAILED");
    return value.result;
  };
  const settings = async () => {
    const value = await cf("GET", "/settings");
    if (
      !value.bindings?.some(
        (binding) =>
          binding.name === "SOURCE_SHA" &&
          binding.text === env.EXPECTED_RELEASE_SHA,
      ) ||
      !value.bindings?.some(
        (binding) => binding.name === "TOKEN_ENCRYPTION_KEY",
      ) ||
      !value.bindings?.some(
        (binding) =>
          binding.name === "ENABLE_GOOGLE_DELIVERY" && binding.text === "false",
      )
    )
      fail("RECOVERY_CONFIGURATION_MISMATCH");
    return value;
  };
  const activeVersion = async () => {
    const active = await cf("GET", "/deployments");
    const deployment = (active.deployments ?? active)?.[0];
    if (
      deployment?.versions?.length !== 1 ||
      deployment.versions[0].percentage !== 100
    )
      fail("RECOVERY_DEPLOYMENT_UNVERIFIED");
    return deployment.versions[0].version_id;
  };
  const verifyTemporaryVersion = async () => {
    const version = await activeVersion();
    await verifyStagingIdentity(
      { ...env, EXPECTED_WORKER_VERSION: version },
      request,
    );
    await verifyRecoveryWorker(
      { ...env, REVIEWED_WORKER_VERSION: env.EXPECTED_WORKER_VERSION },
      request,
    );
    return version;
  };
  const verifyCleanupVersion = async () => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await verifyTemporaryVersion();
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 4) await pause((attempt + 1) * 1000);
      }
    }
    throw lastError;
  };

  const initialSettings = await settings();
  if (
    temporaryBindings.some((name) =>
      initialSettings.bindings.some((binding) => binding.name === name),
    )
  )
    fail("RECOVERY_AUTHORIZATION_ALREADY_PRESENT");
  const token = await obtainAcceptanceToken(env, request);
  if (!token) fail("ADMIN_AUTH_REQUIRED");

  let provisioningStarted = false;
  let report;
  let operationError;
  let cleanupError;
  try {
    provisioningStarted = true;
    await cf("PUT", "/secrets", {
      name: "LEGACY_TOKEN_ENCRYPTION_KEY",
      type: "secret_text",
      text: env.CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY,
    });
    await cf("PUT", "/secrets", {
      name: "GOOGLE_CREDENTIAL_RECOVERY_SCOPE",
      type: "secret_text",
      text: JSON.stringify({
        candidateSha: env.EXPECTED_RELEASE_SHA,
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        mode,
      }),
    });
    const workerVersion = await verifyTemporaryVersion();
    const response = await request(
      `${origin}/api/admin/google-credential-recovery`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(120000),
        headers: {
          authorization: `Bearer ${token}`,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({ mode }),
      },
    );
    const value = await response.json();
    if (!response.ok) {
      const code = value.error?.code;
      fail(
        /^GOOGLE_[A-Z_]{1,100}$/.test(code ?? "")
          ? code
          : "GOOGLE_CREDENTIAL_RECOVERY_FAILED",
      );
    }
    report = {
      mode,
      sourceSha: initial.sourceSha,
      workerVersion,
      ...value.credentialRecovery,
    };
  } catch (error) {
    operationError = error;
  } finally {
    if (provisioningStarted) {
      let deletionFailed = false;
      for (const name of temporaryBindings) {
        let deleted = false;
        for (let attempt = 0; attempt < 3 && !deleted; attempt++) {
          try {
            await cf("DELETE", `/secrets/${name}`, undefined, true);
            deleted = true;
          } catch {
            // Continue deleting other temporary credentials even on failure.
          }
        }
        if (!deleted) deletionFailed = true;
      }
      try {
        const after = await settings();
        if (
          deletionFailed ||
          temporaryBindings.some((name) =>
            after.bindings.some((binding) => binding.name === name),
          ) ||
          !after.bindings.some(
            (binding) => binding.name === "TOKEN_ENCRYPTION_KEY",
          )
        )
          fail("RECOVERY_DISABLE_NOT_CONFIRMED");
        // Secret deletion creates new Worker versions. Allow Cloudflare's active
        // deployment and public version metadata to converge before failing closed.
        await verifyCleanupVersion();
      } catch (error) {
        cleanupError = error;
      }
    }
  }
  if (cleanupError) {
    if (operationError)
      throw new AggregateError(
        [operationError, cleanupError],
        "RECOVERY_DISABLE_NOT_CONFIRMED",
      );
    throw cleanupError;
  }
  if (operationError) throw operationError;
  return { ...report, temporaryRecoveryBindingsAbsent: true };
}

async function main() {
  try {
    const report = await runLegacyGoogleCredentialRecovery(process.env);
    const output = JSON.stringify(report, null, 2);
    console.log(output);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n\`\`\`json\n${output}\n\`\`\`\n`,
      );
  } catch (error) {
    const code = String(error?.message ?? "");
    console.error(
      /^(?:GOOGLE|RECOVERY|STAGING|ADMIN|CLOUDFLARE|TRUSTED|LEGACY)_[A-Z_]{1,120}$/.test(
        code,
      )
        ? code
        : "GOOGLE_CREDENTIAL_RECOVERY_BLOCKED",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
