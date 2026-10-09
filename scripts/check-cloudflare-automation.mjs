import { readFile } from "node:fs/promises";

const stagingWorkflow = await readFile(
  ".github/workflows/cloudflare-staging.yml",
  "utf8",
);
const previewWorkflow = await readFile(
  ".github/workflows/cloudflare-pr-preview.yml",
  "utf8",
);
const productionGateWorkflow = await readFile(
  ".github/workflows/cloudflare-production-gate.yml",
  "utf8",
);
const worker = await readFile("worker/index.mjs", "utf8");
const smoke = await readFile("scripts/smoke-cloudflare-staging.mjs", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Cloudflare automation check failed: ${message}`);
  }
}

assert(
  worker.includes("sourceSha: env.SOURCE_SHA ?? null"),
  "__release must expose the exact source SHA supplied by CI.",
);
assert(
  smoke.includes("releaseJson?.sourceSha !== expectedReleaseSha"),
  "staging smoke must verify the exact deployed source SHA.",
);
assert(
  smoke.includes("waitForExpectedReleaseIdentity") &&
    smoke.includes("CALENDERZW_RELEASE_WAIT_TIMEOUT_MS"),
  "staging smoke must wait for the custom domain to serve the exact deployed SHA before checking assets.",
);
assert(
  stagingWorkflow.includes('checked_out_sha="$(git rev-parse HEAD)"') &&
    stagingWorkflow.includes(
      "--var SOURCE_SHA:${{ steps.exact-head.outputs.sha }}",
    ) &&
    stagingWorkflow.includes(
      "EXPECTED_RELEASE_SHA: ${{ steps.exact-head.outputs.sha }}",
    ),
  "manual staging deploy must carry exact SHA through deploy and smoke.",
);
assert(
  previewWorkflow.includes("ref: ${{ env.PR_HEAD_SHA }}") &&
    previewWorkflow.includes('test "${checked_out_sha}" = "${PR_HEAD_SHA}"'),
  "PR preview workflow must checkout and prove the exact PR head SHA.",
);
assert(
  previewWorkflow.includes("environment: cloudflare-staging") &&
    previewWorkflow.includes(
      "CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}",
    ),
  "PR preview workflow must use the Cloudflare staging environment secret boundary.",
);
assert(
  previewWorkflow.includes(
    "--var SOURCE_SHA:${{ steps.exact-head.outputs.sha }}",
  ) &&
    previewWorkflow.includes(
      "EXPECTED_RELEASE_SHA: ${{ steps.exact-head.outputs.sha }}",
    ),
  "PR preview deploy and smoke must use the exact SHA.",
);
assert(
  !previewWorkflow.includes('--message "PR #'),
  "PR preview deploy message must not use a YAML-comment-prone # in an inline command.",
);
assert(
  previewWorkflow.includes(
    "github.event.pull_request.head.repo.full_name == github.repository",
  ),
  "PR preview deploy must be guarded to same-repository PRs.",
);
assert(
  previewWorkflow.includes("group: cloudflare-staging"),
  "Cloudflare staging deployments must be serialized to avoid misleading evidence.",
);
assert(
  !previewWorkflow.includes("calender.aido.co.zw") ||
    previewWorkflow.includes("Production DNS: unchanged"),
  "preview workflow must not deploy production Cloudflare.",
);
assert(
  productionGateWorkflow.includes("environment: cloudflare-production") &&
    productionGateWorkflow.includes("git merge-base --is-ancestor") &&
    productionGateWorkflow.includes("origin/Calender") &&
    productionGateWorkflow.includes("Production deploy: disabled until DR-166"),
  "production gate must require Calender reachability and keep deploy disabled.",
);

console.log(
  "Cloudflare automation contract OK: exact-head checkout, deploy identity, smoke verification and PR evidence are wired.",
);
