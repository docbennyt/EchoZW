import { appendFileSync } from "node:fs";

export function authorizeCandidate({ sha, pull, reviews, runs, permissions }) {
  if (!/^[a-f0-9]{40}$/.test(sha ?? ""))
    throw new Error("INVALID_CANDIDATE_SHA");
  const reviewedState =
    pull.state === "open" ||
    (pull.state === "closed" &&
      pull.merged === true &&
      Boolean(pull.merged_at) &&
      Boolean(pull.merge_commit_sha));
  if (
    !reviewedState ||
    pull.base.ref !== "Calender" ||
    pull.head.repo?.full_name !== "docbennyt/EchoZW" ||
    pull.head.sha !== sha
  )
    throw new Error("CANDIDATE_HEAD_MISMATCH");
  const latest = new Map();
  for (const review of reviews) {
    if (review.state !== "COMMENTED") latest.set(review.user.login, review);
  }
  if (
    ![...latest.values()].some(
      (review) =>
        review.state === "APPROVED" &&
        review.commit_id === sha &&
        review.user.login !== pull.user.login &&
        ["admin", "maintain", "write"].includes(permissions[review.user.login]),
    ) ||
    [...latest.values()].some((review) => review.state === "CHANGES_REQUESTED")
  )
    throw new Error("EXACT_CANDIDATE_REVIEW_REQUIRED");
  for (const workflow of [
    ".github/workflows/ci.yml",
    ".github/workflows/cloudflare-pr-preview.yml",
  ]) {
    const latestRun = runs
      .filter(
        (run) =>
          run.head_sha === sha &&
          run.path === workflow &&
          run.event === "pull_request",
      )
      .sort((first, second) => second.id - first.id)[0];
    if (latestRun?.conclusion !== "success")
      throw new Error("CANDIDATE_CI_REQUIRED");
  }
  return sha;
}

async function main() {
  if (process.env.GITHUB_REF !== "refs/heads/Calender")
    throw new Error("TRUSTED_WORKFLOW_BRANCH_REQUIRED");
  const sha = process.env.CANDIDATE_SHA;
  const number = process.env.CANDIDATE_PR;
  if (!/^[a-f0-9]{40}$/.test(sha ?? "") || !/^[1-9][0-9]*$/.test(number ?? ""))
    throw new Error("INVALID_CANDIDATE_INPUT");
  const api = async (path) => {
    const response = await fetch(
      `https://api.github.com/repos/docbennyt/EchoZW/${path}`,
      {
        headers: {
          authorization: `Bearer ${process.env.GH_TOKEN}`,
          accept: "application/vnd.github+json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) throw new Error("CANDIDATE_AUTHORIZATION_LOOKUP_FAILED");
    return response.json();
  };
  const pull = await api(`pulls/${number}`);
  const reviews = await api(`pulls/${number}/reviews?per_page=100`);
  if (reviews.length === 100) throw new Error("REVIEW_PAGINATION_REQUIRED");
  const runs = (await api(`actions/runs?head_sha=${sha}&per_page=100`))
    .workflow_runs;
  const permissions = {};
  for (const login of new Set(reviews.map((review) => review.user.login))) {
    permissions[login] = (
      await api(`collaborators/${encodeURIComponent(login)}/permission`)
    ).permission;
  }
  authorizeCandidate({ sha, pull, reviews, runs, permissions });
  appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\n`);
  console.log(`Approved immutable staging candidate: ${sha}`);
}

if (process.argv[1]?.endsWith("authorize-staging-candidate.mjs")) await main();
