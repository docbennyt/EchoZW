import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");
const [preview, staging, production, smoke, credentialRecovery] =
  await Promise.all([
    read(".github/workflows/cloudflare-pr-preview.yml"),
    read(".github/workflows/cloudflare-staging.yml"),
    read(".github/workflows/cloudflare-production-gate.yml"),
    read("scripts/smoke-native-recovery.mjs"),
    read(".github/workflows/cloudflare-legacy-google-credential-recovery.yml"),
  ]);
function assert(condition, message) {
  if (!condition)
    throw new Error(`Cloudflare automation check failed: ${message}`);
}
assert(
  preview.includes("pull_request:") &&
    preview.includes("persist-credentials: false"),
  "PR tests must use unprivileged checkout.",
);
assert(
  !preview.includes("secrets.") &&
    !preview.includes("environment:") &&
    !preview.includes("write"),
  "PR verification must never receive protected secrets or write permissions.",
);
assert(
  !preview.includes("workflow_run") && !preview.includes("pull_request_target"),
  "untrusted PR verification must not use privileged events.",
);
assert(
  staging.includes("workflow_dispatch:") &&
    staging.includes("github.ref == 'refs/heads/Calender'"),
  "privileged control workflow must run from protected Calender.",
);
assert(
  staging.includes("authorize-staging-candidate.mjs") &&
    staging.includes("Recheck approval after environment review"),
  "candidate review and CI must be checked before and after deployment approval.",
);
assert(
  /\n\s{4}environment: cloudflare-staging\n/.test(
    staging.split("  deploy:")[1]?.split("  acceptance:")[0] ?? "",
  ) &&
    /\n\s{4}environment: cloudflare-staging\n/.test(
      staging.split("  acceptance:")[1] ?? "",
    ) &&
    staging.includes("  acceptance:") &&
    staging.includes("verify-active-worker-deployment.mjs"),
  "deployment and acceptance must use separate protected jobs and verify the active deployment via Cloudflare.",
);
const packageJob = staging.split("  package:")[1]?.split("  deploy:")[0];
assert(
  packageJob &&
    !packageJob.includes("secrets.") &&
    !packageJob.includes("environment:"),
  "candidate build must run on a runner without privileged inputs.",
);
const deployJob = staging.split("  deploy:")[1]?.split("  acceptance:")[0];
assert(
  deployJob?.includes("--no-bundle") &&
    deployJob.includes("prepare-staging-deployment.mjs") &&
    !deployJob.includes("ref: ${{ needs.authorize.outputs.sha }}"),
  "privileged deployment must execute trusted tooling and configuration, not candidate scripts.",
);
assert(
  staging.includes("group: cloudflare-staging") &&
    staging.includes("cancel-in-progress: false"),
  "serialize deployment through acceptance.",
);
assert(
  staging.includes("EXPECTED_WORKER_VERSION:") &&
    smoke.includes("await verifyStagingIdentity(process.env);"),
  "verify exact SHA and Worker identity before authentication.",
);
assert(
  smoke.includes("BLOCKED: CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN") &&
    smoke.includes("BLOCKED: CALENDERZW_STAGING_FEED_URL"),
  "missing admin and original-feed acceptance remain blocking.",
);
const credentialRecoveryJob = credentialRecovery.split("  recover:")[1];
assert(
  credentialRecovery.includes("workflow_dispatch:") &&
    credentialRecovery.includes("github.ref == 'refs/heads/Calender'") &&
    !credentialRecovery.includes("\n  pull_request:") &&
    !credentialRecovery.includes("\n  pull_request_target:") &&
    !credentialRecovery.includes("\n  workflow_run:"),
  "legacy-key recovery must be an explicit trusted-branch operation.",
);
assert(
  credentialRecoveryJob?.includes("environment: cloudflare-staging") &&
    credentialRecoveryJob.includes("persist-credentials: false") &&
    credentialRecoveryJob.includes("authorize-staging-candidate.mjs") &&
    credentialRecoveryJob.includes("recover-reviewed-worker.mjs") &&
    credentialRecoveryJob.includes("verify-recovery-worker.mjs") &&
    credentialRecoveryJob.includes("recover-legacy-google-credentials.mjs") &&
    credentialRecoveryJob.includes(
      "secrets.CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY",
    ) &&
    credentialRecoveryJob.includes(
      "secrets.CALENDERZW_HISTORICAL_TOKEN_ENCRYPTION_KEY_2",
    ) &&
    credentialRecovery.includes("options: [railway, historical2]") &&
    credentialRecoveryJob.includes(
      "inputs.key_source == 'historical2' && inputs.mode == 'compatibility'",
    ) &&
    !credentialRecoveryJob.includes(
      "secrets.CALENDERZW_LEGACY_TOKEN_ENCRYPTION_KEY ||",
    ) &&
    !credentialRecoveryJob.includes(
      "secrets.CALENDERZW_HISTORICAL_TOKEN_ENCRYPTION_KEY_2 ||",
    ),
  "each historical key must stay inside its explicit reviewed protected recovery path.",
);
assert(
  production.includes("environment: cloudflare-production") &&
    production.includes("git merge-base --is-ancestor") &&
    production.includes("Production deploy: disabled until DR-166"),
  "production cutover remains gated.",
);
console.log(
  "Cloudflare automation: unprivileged PR verification; reviewed immutable staging; isolated deployment and acceptance.",
);
