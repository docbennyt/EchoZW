import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

function latestJob(jobs, name) {
  return jobs
    .filter((job) => job.name === name)
    .sort(
      (a, b) =>
        (b.run_attempt ?? 0) - (a.run_attempt ?? 0) ||
        (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) ||
        (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0) ||
        (b.id ?? 0) - (a.id ?? 0),
    )[0];
}

export function recoverReviewedWorker({ run, jobs, artifacts, log, sha }) {
  const repository = "docbennyt/EchoZW";
  if (
    !/^[a-f0-9]{40}$/.test(sha ?? "") ||
    run.repository?.full_name !== repository ||
    run.path !== ".github/workflows/cloudflare-staging.yml" ||
    run.event !== "workflow_dispatch" ||
    run.head_branch !== "Calender" ||
    run.status !== "completed"
  )
    throw new Error("TRUSTED_DEPLOYMENT_RUN_REQUIRED");
  const job = (name) => latestJob(jobs, name);
  const deployment = job("deploy");
  // gh prefixes log lines with the authenticated job and step, not PR output.
  const stepLog = (name) =>
    log
      .split("\n")
      .map((line) => line.split("\t"))
      .filter((parts) => parts[0] === "deploy" && parts[1] === name)
      .map((parts) =>
        parts
          .slice(2)
          .join("\t")
          .replace(/^\S+\s/, ""),
      )
      .join("\n");
  const oneValue = (text, expression) => {
    const matches = [...text.matchAll(expression)];
    return matches.length === 1 ? matches[0][1] : undefined;
  };
  const approvalSha = oneValue(
    stepLog("Recheck approval after environment review"),
    /^Approved immutable staging candidate: ([a-f0-9]{40})$/gm,
  );
  const verifiedArtifactLog = stepLog("Verify artifact identity and bytes");
  const artifactId = oneValue(
    verifiedArtifactLog,
    /^\s*ARTIFACT_ID: ([0-9]+)$/gm,
  );
  const digest = oneValue(
    verifiedArtifactLog,
    /^\s*ARTIFACT_DIGEST: (?:sha256:)?([a-f0-9]{64})$/gm,
  );
  const preparedSha = oneValue(
    stepLog("Prepare trusted deployment configuration"),
    /^\s*CANDIDATE_SHA: ([a-f0-9]{40})$/gm,
  );
  const uploadLog = stepLog("Deploy reviewed bundle");
  const uploadedSha = oneValue(
    uploadLog,
    /^\s*CANDIDATE_SHA: ([a-f0-9]{40})$/gm,
  );
  const checks = {
    candidateApproval: approvalSha === sha,
    candidateConfiguration: preparedSha === sha,
    candidateUpload: uploadedSha === sha,
    successfulAuthorization: job("authorize")?.conclusion === "success",
    successfulPackaging: job("package")?.conclusion === "success",
    verifiedDeploymentState: ["success", "failure"].includes(
      deployment?.conclusion,
    ),
    verifiedDeploymentSteps: [
      "Recheck approval after environment review",
      "Verify artifact identity and bytes",
      "Prepare trusted deployment configuration",
    ].every((name) =>
      deployment?.steps?.some(
        (step) => step.name === name && step.conclusion === "success",
      ),
    ),
    verifiedArtifactBinding: artifacts.some(
      (artifact) =>
        String(artifact.id) === artifactId &&
        artifact.name === `reviewed-worker-${sha}` &&
        !artifact.expired &&
        artifact.digest === `sha256:${digest}`,
    ),
  };
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedChecks.length) {
    const error = new Error("VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED");
    error.failedChecks = failedChecks;
    throw error;
  }
  const versions = [
    ...uploadLog.matchAll(/^Current Version ID:\s*([a-f0-9-]{36})$/gm),
  ];
  if (
    versions.length !== 1 ||
    !uploadLog.includes("Uploaded calenderzw-edge-staging") ||
    !uploadLog.includes("Deployed calenderzw-edge-staging triggers")
  )
    throw new Error("TRUSTED_UPLOAD_VERSION_REQUIRED");
  return { version: versions[0][1], jobId: deployment.id };
}

async function main() {
  if (process.env.GITHUB_REF !== "refs/heads/Calender")
    throw new Error("TRUSTED_WORKFLOW_BRANCH_REQUIRED");
  const id = process.env.DEPLOYMENT_RUN;
  if (!/^[1-9][0-9]*$/.test(id ?? ""))
    throw new Error("INVALID_DEPLOYMENT_RUN");
  const prefix = "repos/docbennyt/EchoZW";
  const api = (path) => {
    try {
      return JSON.parse(
        execFileSync("gh", ["api", `${prefix}/${path}`], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 30000,
          maxBuffer: 8 * 1024 * 1024,
        }),
      );
    } catch {
      throw new Error("TRUSTED_DEPLOYMENT_LOOKUP_FAILED");
    }
  };
  const run = api(`actions/runs/${id}`);
  const { jobs, total_count: jobsCount } = api(
    `actions/runs/${id}/jobs?filter=all&per_page=100`,
  );
  const { artifacts, total_count: artifactsCount } = api(
    `actions/runs/${id}/artifacts?per_page=100`,
  );
  if (jobsCount > 100 || artifactsCount > 100)
    throw new Error("TRUSTED_DEPLOYMENT_PAGINATION_REQUIRED");
  const deployment = latestJob(jobs, "deploy");
  if (!Number.isSafeInteger(deployment?.id))
    throw new Error("TRUSTED_DEPLOYMENT_JOB_REQUIRED");
  let log;
  try {
    log = execFileSync(
      "gh",
      [
        "run",
        "view",
        id,
        "--repo",
        "docbennyt/EchoZW",
        "--job",
        String(deployment.id),
        "--log",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
  } catch {
    throw new Error("TRUSTED_DEPLOYMENT_LOG_UNAVAILABLE");
  }
  let version;
  try {
    ({ version } = recoverReviewedWorker({
      run,
      jobs,
      artifacts,
      log,
      sha: process.env.CANDIDATE_SHA,
    }));
  } catch (error) {
    if (error.failedChecks) {
      console.error(
        JSON.stringify({
          event: "staging.provenance.rejected",
          failedChecks: error.failedChecks,
        }),
      );
    }
    throw error;
  }
  appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
  console.log(`Verified reviewed deployment provenance; Worker ${version}`);
}
if (process.argv[1]?.endsWith("recover-reviewed-worker.mjs")) await main();
