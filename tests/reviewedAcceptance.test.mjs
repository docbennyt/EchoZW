// @vitest-environment node
/* global URL */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { recoverReviewedWorker } from "../scripts/recover-reviewed-worker.mjs";

const sha = "a".repeat(40);
const version = "12341525-6d46-4fdb-93aa-95f1cf78ca06";
const fixture = () => ({
  sha,
  run: {
    repository: { full_name: "docbennyt/EchoZW" },
    path: ".github/workflows/cloudflare-staging.yml",
    event: "workflow_dispatch",
    head_branch: "Calender",
    status: "completed",
  },
  jobs: [
    { name: "authorize", conclusion: "success" },
    { name: "package", conclusion: "success" },
    {
      name: "deploy",
      id: 123,
      conclusion: "failure",
      steps: [
        "Recheck approval after environment review",
        "Verify artifact identity and bytes",
        "Prepare trusted deployment configuration",
      ].map((name) => ({ name, conclusion: "success" })),
    },
  ],
  artifacts: [
    {
      id: 987,
      name: `reviewed-worker-${sha}`,
      expired: false,
      digest: `sha256:${sha}${"b".repeat(24)}`,
    },
  ],
  log: [
    [
      "Recheck approval after environment review",
      `Approved immutable staging candidate: ${sha}`,
    ],
    ["Verify artifact identity and bytes", "  ARTIFACT_ID: 987"],
    [
      "Verify artifact identity and bytes",
      `  ARTIFACT_DIGEST: ${sha}${"b".repeat(24)}`,
    ],
    ["Prepare trusted deployment configuration", `  CANDIDATE_SHA: ${sha}`],
    ["Deploy reviewed bundle", `  CANDIDATE_SHA: ${sha}`],
    ["Deploy reviewed bundle", "Uploaded calenderzw-edge-staging"],
    ["Deploy reviewed bundle", "Deployed calenderzw-edge-staging triggers"],
    ["Deploy reviewed bundle", `Current Version ID: ${version}`],
  ]
    .map(([step, text]) => `deploy\t${step}\t2026-10-24T21:07:52Z ${text}`)
    .join("\n"),
});

describe("reviewed acceptance-only provenance", () => {
  it("classifies a rejected artifact without exposing log or artifact values", () => {
    const input = fixture();
    input.artifacts[0].digest = "private-value-must-not-be-printed";
    let failure;
    try {
      recoverReviewedWorker(input);
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toBe("VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED");
    expect(failure?.failedChecks).toEqual(["verifiedArtifactBinding"]);
    expect(JSON.stringify(failure)).not.toContain("private-value");
  });
  it("distinguishes missing trusted log attribution from invalid artifact metadata", () => {
    const input = fixture();
    input.log = input.log.replaceAll(
      "\tRecheck approval after environment review\t",
      "\tUNKNOWN STEP\t",
    );
    let failure;
    try {
      recoverReviewedWorker(input);
    } catch (error) {
      failure = error;
    }
    expect(failure?.failedChecks).toEqual(["candidateApproval"]);
  });
  it("recovers the uploaded reviewed artifact even when post-upload verification failed", () => {
    expect(recoverReviewedWorker(fixture())).toEqual({ version, jobId: 123 });
  });
  it.each(["repository", "path", "event", "head_branch", "status"])(
    "rejects untrusted run %s",
    (field) => {
      const input = fixture();
      input.run[field] = "untrusted";
      expect(() => recoverReviewedWorker(input)).toThrow(
        "TRUSTED_DEPLOYMENT_RUN_REQUIRED",
      );
    },
  );
  it("rejects another candidate's otherwise valid artifact", () => {
    const input = fixture();
    input.sha = "b".repeat(40);
    expect(() => recoverReviewedWorker(input)).toThrow(
      "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
    );
  });
  it.each([
    [
      "Approved immutable staging candidate: " + sha,
      "Approved immutable staging candidate: " + "b".repeat(40),
    ],
    ["ARTIFACT_ID: 987", "ARTIFACT_ID: 988"],
    [
      "ARTIFACT_DIGEST: " + sha + "b".repeat(24),
      "ARTIFACT_DIGEST: " + "c".repeat(64),
    ],
    ["CANDIDATE_SHA: " + sha, "CANDIDATE_SHA: " + "c".repeat(40)],
  ])(
    "rejects an unrelated artifact despite matching-name presence: %s",
    (from, to) => {
      const input = fixture();
      input.log = input.log.replace(from, to);
      expect(() => recoverReviewedWorker(input)).toThrow(
        "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
      );
    },
  );
  it("selects the latest deployment while retaining prior-attempt successful prerequisites", () => {
    const input = fixture();
    input.jobs.push({
      ...input.jobs[2],
      id: 456,
      started_at: "2026-10-24T21:07:00Z",
    });
    expect(recoverReviewedWorker(input)).toEqual({ version, jobId: 456 });
  });
  it("does not fall back to prior successful authorization after a newer failure", () => {
    const input = fixture();
    input.jobs.push({
      name: "authorize",
      conclusion: "failure",
      started_at: "2026-10-24T22:00:00Z",
      id: 789,
    });
    expect(() => recoverReviewedWorker(input)).toThrow(
      "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
    );
  });
  it("rejects a newer cancelled authorization even when it never started", () => {
    const input = fixture();
    input.jobs[0].run_attempt = 1;
    input.jobs[0].started_at = "2026-10-24T20:00:00Z";
    input.jobs.push({
      name: "authorize",
      conclusion: "cancelled",
      run_attempt: 2,
      started_at: null,
      id: 790,
    });
    expect(() => recoverReviewedWorker(input)).toThrow(
      "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
    );
  });
  it.each(["authorize", "package"])("rejects unsuccessful %s", (name) => {
    const input = fixture();
    input.jobs.find((job) => job.name === name).conclusion = "failure";
    expect(() => recoverReviewedWorker(input)).toThrow(
      "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
    );
  });
  it.each([0, 1, 2])(
    "requires protected deploy step %s to have succeeded",
    (index) => {
      const input = fixture();
      input.jobs[2].steps[index].conclusion = "failure";
      expect(() => recoverReviewedWorker(input)).toThrow(
        "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
      );
    },
  );
  it.each(["expired", "digest"])(
    "rejects unverifiable artifact %s",
    (field) => {
      const input = fixture();
      input.artifacts[0][field] = field === "expired" ? true : "";
      expect(() => recoverReviewedWorker(input)).toThrow(
        "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
      );
    },
  );
  it.each(["", `Current Version ID: ${version}`])(
    "rejects logs without verified provenance",
    (log) => {
      expect(() => recoverReviewedWorker({ ...fixture(), log })).toThrow(
        "VERIFIED_DEPLOYMENT_ARTIFACT_REQUIRED",
      );
    },
  );
  it.each([
    fixture().log.replace(
      `Current Version ID: ${version}`,
      "no upload version",
    ),
    `${fixture().log}\ndeploy\tDeploy reviewed bundle\t2026-10-24T21:07:52Z Current Version ID: ${version}`,
  ])(
    "rejects incomplete or ambiguous upload evidence after valid provenance",
    (log) => {
      expect(() => recoverReviewedWorker({ ...fixture(), log })).toThrow(
        "TRUSTED_UPLOAD_VERSION_REQUIRED",
      );
    },
  );
  it("does not treat version strings outside the upload step as evidence", () => {
    expect(
      recoverReviewedWorker({
        ...fixture(),
        log: `${fixture().log}\nCurrent Version ID: untrusted`,
      }),
    ).toEqual({ version, jobId: 123 });
  });
});

describe("acceptance-only privileged boundary", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/cloudflare-acceptance.yml", import.meta.url),
    "utf8",
  );
  const authorize = workflow.split("  authorize:")[1].split("  acceptance:")[0];
  const acceptance = workflow.split("  acceptance:")[1];
  it("runs only from protected Calender with an independent exact-candidate check", () => {
    expect(authorize).toContain("github.ref == 'refs/heads/Calender'");
    expect(authorize).toContain("authorize-staging-candidate.mjs");
    expect(authorize).not.toContain("secrets.");
    expect(workflow).not.toMatch(/pull_request_target:|workflow_run:/);
  });
  it("uses protected code, environment approval, concurrency and read-only permissions", () => {
    expect(acceptance).toContain("needs: authorize");
    expect(acceptance).toContain("environment: cloudflare-staging");
    expect(acceptance).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("group: cloudflare-staging");
    expect(workflow).toContain("cancel-in-progress: false");
    expect(workflow).not.toMatch(/ref:.*(?:inputs|needs)\./);
    expect(workflow).not.toMatch(/permissions:[\s\S]*write/);
    expect(workflow).not.toContain("wrangler");
  });
  it("requires provenance, API and public identity verification before test secrets", () => {
    const stages = [
      "Recheck exact approval after environment review",
      "Recover immutable version from verified deployment provenance",
      "Verify active version through Cloudflare API",
      "Verify public SHA and version before releasing test credentials",
      "Authenticated and original-feed acceptance",
    ].map((name) => acceptance.indexOf(name));
    expect(stages.every((position) => position >= 0)).toBe(true);
    expect([...stages].sort((a, b) => a - b)).toEqual(stages);
    expect(
      acceptance.indexOf("CALENDERZW_STAGING_ADMIN_PASSWORD:"),
    ).toBeGreaterThan(stages[4]);
    expect(acceptance).toContain("npm run browser:smoke:release");
    expect(acceptance).toContain("Recheck active version after acceptance");
    expect(acceptance).not.toMatch(/continue-on-error|if:\s*always/);
  });
});
