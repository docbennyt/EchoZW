import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { obtainAcceptanceToken } from "./recovery-acceptance.mjs";
import { verifyStagingIdentity } from "./verify-staging-identity.mjs";

const origin = "https://next.calender.aido.co.zw";
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const fail = (code) => {
  throw new Error(code);
};

export function parseRecoveryPlan(raw, sha, now = Date.now()) {
  try {
    if (typeof raw !== "string" || raw.length > 32768) throw new Error();
    const plan = JSON.parse(raw);
    const expiry = Date.parse(plan.expiresAt);
    if (
      !/^[a-f0-9]{40}$/.test(sha ?? "") ||
      plan.candidateSha !== sha ||
      !Number.isFinite(expiry) ||
      expiry <= now ||
      expiry - now > 86400000 ||
      !Array.isArray(plan.subscriptions) ||
      !plan.subscriptions.length ||
      plan.subscriptions.length > 25
    )
      throw new Error();
    const ids = new Set();
    for (const row of plan.subscriptions) {
      if (
        !uuid(row.subscriptionId) ||
        !uuid(row.timetableId) ||
        !uuid(row.ownerId) ||
        !["active", "failed"].includes(row.status) ||
        !integer(row.desiredRevision) ||
        row.desiredRevision === 0 ||
        !integer(row.connectionGeneration) ||
        !integer(row.mappingCount) ||
        (row.lastSyncedAt !== null &&
          !Number.isFinite(Date.parse(row.lastSyncedAt))) ||
        ids.has(row.subscriptionId)
      )
        throw new Error();
      ids.add(row.subscriptionId);
    }
    return plan;
  } catch {
    fail("RECOVERY_PLAN_INVALID");
  }
}

export function previewIsSafe(value) {
  return Boolean(
    value?.readOnly === true &&
    !value.skipped &&
    value.ownershipReviewCount === 0 &&
    [
      "expectedEvents",
      "remoteManagedEvents",
      "localMappings",
      "wouldCreate",
      "wouldUpdate",
      "wouldDelete",
      "unchanged",
    ].every((key) => integer(value[key])) &&
    value.expectedEvents > 0 &&
    value.remoteManagedEvents > 0 &&
    value.localMappings > 0 &&
    value.wouldCreate === 0 &&
    value.wouldDelete === 0 &&
    value.expectedEvents === value.wouldUpdate + value.unchanged,
  );
}

function redactedPreview(value) {
  const result = {};
  for (const key of [
    "expectedEvents",
    "remoteManagedEvents",
    "localMappings",
    "wouldCreate",
    "wouldUpdate",
    "wouldDelete",
    "unchanged",
    "ownershipReviewCount",
    "publishedRevision",
    "connectionGeneration",
    "remoteContentMismatchCount",
  ])
    result[key] = integer(value?.[key]) ? value[key] : null;
  return {
    ...result,
    remoteContentMismatchFields: Object.fromEntries(
      [
        "summary",
        "description",
        "location",
        "start",
        "end",
        "startZone",
        "endZone",
        "recurrence",
        "useDefault",
        "overrides",
      ]
        .map((field) => [field, value?.remoteContentMismatchFields?.[field]])
        .filter(
          ([, count]) =>
            integer(count) &&
            count > 0 &&
            integer(value?.expectedEvents) &&
            count <= value.expectedEvents,
        ),
    ),
    readOnly: value?.readOnly === true,
    remoteReadComplete: value?.remoteReadComplete === true,
    remoteContentsVerified: value?.remoteContentsVerified === true,
  };
}

export async function runGoogleRecovery(env, dependencies = {}) {
  const request = dependencies.request ?? fetch;
  const delay =
    dependencies.delay ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const mode = env.RECOVERY_MODE;
  if (!["preflight", "preview", "verify", "canary", "disable"].includes(mode))
    fail("RECOVERY_MODE_INVALID");
  // Revocation must remain available after a private selection plan expires.
  const plan =
    mode === "disable"
      ? null
      : parseRecoveryPlan(env.RECOVERY_PLAN, env.EXPECTED_RELEASE_SHA);
  if (env.GITHUB_REF !== "refs/heads/Calender")
    fail("TRUSTED_WORKFLOW_BRANCH_REQUIRED");
  // This must precede authentication, private diagnostic requests and scope writes.
  const initial = await verifyStagingIdentity(env, request);
  const report = { mode, sourceSha: initial.sourceSha, results: [] };
  if (mode === "preflight") return { ...report, identityVerified: true };
  const cf = async (method, suffix, body) => {
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
    if (!response.ok || value.success !== true)
      fail("RECOVERY_CONFIGURATION_OPERATION_FAILED");
    return value.result;
  };
  const settings = async () => {
    const value = await cf("GET", "/settings");
    if (
      !value.bindings?.some(
        (b) => b.name === "SOURCE_SHA" && b.text === env.EXPECTED_RELEASE_SHA,
      ) ||
      !value.bindings?.some(
        (b) => b.name === "ENABLE_GOOGLE_DELIVERY" && b.text === "false",
      )
    )
      fail("RECOVERY_CONFIGURATION_MISMATCH");
    return value;
  };
  const verifyEffectiveDeployment = async (scopePresent) => {
    const active = await cf("GET", "/deployments");
    const deployment = (active.deployments ?? active)?.[0];
    if (
      deployment?.versions?.length !== 1 ||
      deployment.versions[0].percentage !== 100
    )
      fail("RECOVERY_DEPLOYMENT_UNVERIFIED");
    const version = deployment.versions[0].version_id;
    const resources = await cf("GET", `/versions/${version}`);
    const bindings = resources.resources?.bindings;
    if (
      !Array.isArray(bindings) ||
      !bindings.some(
        (b) => b.name === "SOURCE_SHA" && b.text === env.EXPECTED_RELEASE_SHA,
      ) ||
      !bindings.some(
        (b) => b.name === "ENABLE_GOOGLE_DELIVERY" && b.text === "false",
      ) ||
      bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY") !== scopePresent
    )
      fail("RECOVERY_ACTIVE_BINDINGS_NOT_CONVERGED");
    await verifyStagingIdentity(
      { ...env, EXPECTED_WORKER_VERSION: version },
      request,
    );
    return version;
  };
  // Secret writes create Worker versions before every control/data-plane read
  // agrees. Retry only verification, never provisioning or event delivery.
  const verifyConvergedDeployment = async (scopePresent) => {
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        return await verifyEffectiveDeployment(scopePresent);
      } catch (error) {
        lastError = error;
        if (attempt < 4) await delay((attempt + 1) * 1000);
      }
    }
    throw lastError;
  };
  if (mode === "disable") {
    const value = await settings();
    if (value.bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY"))
      await cf("DELETE", "/secrets/GOOGLE_RECOVERY_CANARY");
    const after = await settings();
    if (after.bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY"))
      fail("RECOVERY_DISABLE_NOT_CONFIRMED");
    return {
      ...report,
      recoveryAuthorizationAbsent: true,
      workerVersion: await verifyConvergedDeployment(false),
    };
  }
  const token = await obtainAcceptanceToken(env, request);
  if (!token) fail("ADMIN_AUTH_REQUIRED");
  const diagnostic = async (row, options) => {
    const response = await request(
      `${origin}/api/admin/timetables/${row.timetableId}/google-calendar-sync`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(45000),
        headers: {
          authorization: `Bearer ${token}`,
          origin,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subscriptionId: row.subscriptionId,
          ...options,
        }),
      },
    );
    const value = await response.json();
    if (!response.ok) {
      const code = value.error?.code;
      fail(
        /^GOOGLE_[A-Z_]{1,80}$/.test(code ?? "")
          ? code
          : "GOOGLE_DIAGNOSTIC_FAILED",
      );
    }
    return value.googleCalendarSync;
  };
  const selected = Number(env.RECOVERY_INDEX ?? "0");
  if (!integer(selected) || selected >= plan.subscriptions.length)
    fail("RECOVERY_SELECTION_INVALID");
  const rows =
    mode === "canary"
      ? [[selected, plan.subscriptions[selected]]]
      : plan.subscriptions.map((row, index) => [index, row]);
  for (const [index, row] of rows) {
    let scopeProvisioned = false;
    try {
      const credential = await diagnostic(row, {
        dryRun: true,
        credentialCheckOnly: true,
      });
      if (credential?.decryptionCompatible !== true)
        fail("GOOGLE_CREDENTIAL_CHECK_FAILED");
      const preview = await diagnostic(row, {
        dryRun: true,
        credentialCheckOnly: false,
      });
      if (
        preview?.subscriptionId !== row.subscriptionId ||
        preview?.timetableId !== row.timetableId
      )
        fail("GOOGLE_DIAGNOSTIC_IDENTITY_MISMATCH");
      const safe = previewIsSafe(preview);
      const guard = preview.executionGuard;
      const guarded = Boolean(
        guard?.revision === row.desiredRevision &&
        guard?.connectionGeneration === row.connectionGeneration &&
        guard?.maxCreates === 0 &&
        guard?.maxDeletes === 0,
      );
      const result = {
        index,
        desiredRevision: row.desiredRevision,
        credentialCheckPassed: true,
        preview: redactedPreview(preview),
        previewWithinInitialBounds: safe,
        safeToProceed: safe && guarded && row.status === "active",
      };
      report.results.push(result);
      if (mode !== "canary") continue;
      if (!guarded) fail("GOOGLE_EXECUTION_GUARD_UNAVAILABLE");
      if (!safe || row.status !== "active" || !row.lastSyncedAt)
        fail("GOOGLE_CANARY_UNSAFE_PREVIEW");
      await verifyStagingIdentity(env, request);
      const config = await settings();
      if (config.bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY"))
        fail("RECOVERY_AUTHORIZATION_ALREADY_PRESENT");
      if (Date.parse(plan.expiresAt) <= Date.now() + 60000)
        fail("RECOVERY_PLAN_EXPIRES_TOO_SOON");
      // A time-limited operator plan is the authority, never an HTTP caller's ID.
      const scope = {
        candidateSha: plan.candidateSha,
        ownerId: row.ownerId,
        timetableId: row.timetableId,
        subscriptionId: row.subscriptionId,
        expiresAt: new Date(
          Math.min(Date.parse(plan.expiresAt), Date.now() + 1800000),
        ).toISOString(),
        mode: "deliver",
        revision: guard.revision,
        connectionGeneration: guard.connectionGeneration,
        maxCreates: 0,
        maxDeletes: 0,
      };
      // If the response is lost, finally still attempts revocation.
      scopeProvisioned = true;
      await cf("PUT", "/secrets", {
        name: "GOOGLE_RECOVERY_CANARY",
        type: "secret_text",
        text: JSON.stringify(scope),
      });
      result.workerVersion = await verifyConvergedDeployment(true);
      const queued = await diagnostic(row, { dryRun: false });
      if (queued?.queued !== true) fail("GOOGLE_RECONCILIATION_NOT_QUEUED");
      result.queued = true;
      // No polling delivery engine: these are read-only provider comparisons.
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await delay(15000);
        const after = await diagnostic(row, { dryRun: true });
        result.after = redactedPreview(after);
        if (
          previewIsSafe(after) &&
          after.wouldUpdate === 0 &&
          after.unchanged === after.expectedEvents &&
          after.remoteContentsVerified === true
        ) {
          result.mappingComparisonConverged = true;
          result.remoteContentsVerified = true;
          break;
        }
      }
      if (!result.mappingComparisonConverged)
        fail("GOOGLE_CANARY_COMPARISON_NOT_CONVERGED");
      // DB watermarks and actual event payloads require independent verification.
      result.fullyVerified = false;
    } catch (error) {
      const code = String(error?.message ?? "");
      report.results.push({
        index,
        error:
          /^(?:GOOGLE|RECOVERY|STAGING|ADMIN|CLOUDFLARE)_[A-Z_]{1,100}$/.test(
            code,
          )
            ? code
            : "GOOGLE_DIAGNOSTIC_FAILED",
      });
    } finally {
      if (scopeProvisioned) {
        const before = await settings();
        if (before.bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY"))
          await cf("DELETE", "/secrets/GOOGLE_RECOVERY_CANARY");
        const value = await settings();
        if (value.bindings.some((b) => b.name === "GOOGLE_RECOVERY_CANARY"))
          fail("RECOVERY_DISABLE_NOT_CONFIRMED");
        report.recoveryAuthorizationAbsent = true;
        report.workerVersion = await verifyConvergedDeployment(false);
      }
    }
  }
  return report;
}

async function main() {
  try {
    const report = await runGoogleRecovery(process.env);
    const output = JSON.stringify(report, null, 2);
    console.log(output);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n\`\`\`json\n${output}\n\`\`\`\n`,
      );
    if (report.results.some((result) => result.error)) process.exitCode = 1;
  } catch (error) {
    const code = String(error?.message ?? "");
    console.error(
      /^(?:GOOGLE|RECOVERY|STAGING|ADMIN|CLOUDFLARE|TRUSTED)_[A-Z_]{1,100}$/.test(
        code,
      )
        ? code
        : "GOOGLE_RECOVERY_BLOCKED",
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
