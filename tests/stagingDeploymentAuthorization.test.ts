import { describe, expect, it, vi } from "vitest";
import { authorizeCandidate } from "../scripts/authorize-staging-candidate.mjs";
import { verifyStagingIdentity } from "../scripts/verify-staging-identity.mjs";

const sha = "a".repeat(40);
const fixture = () => ({
  sha,
  pull: {
    state: "open",
    base: { ref: "Calender" },
    head: { sha, repo: { full_name: "docbennyt/EchoZW" } },
    user: { login: "author" },
  },
  reviews: [{ user: { login: "reviewer" }, state: "APPROVED", commit_id: sha }],
  permissions: { reviewer: "write" },
  runs: ["ci.yml", "cloudflare-pr-preview.yml"].map((name, index) => ({
    id: index + 1,
    head_sha: sha,
    path: `.github/workflows/${name}`,
    event: "pull_request",
    conclusion: "success",
  })),
});

describe("reviewed staging authorization", () => {
  it("allows only the current immutable reviewed candidate with passing checks", () => {
    expect(authorizeCandidate(fixture())).toBe(sha);
  });
  it("permits reviewed merged heads but rejects unmerged closed PRs", () => {
    const input = fixture();
    const merged = {
      ...input,
      pull: {
        ...input.pull,
        state: "closed",
        merged: true,
        merged_at: "2026-10-29T07:00:00Z",
        merge_commit_sha: "b".repeat(40),
      },
    };
    expect(authorizeCandidate(merged)).toBe(sha);
    const unmerged = {
      ...merged,
      pull: { ...merged.pull, merged: false },
    };
    expect(() => authorizeCandidate(unmerged)).toThrow(
      "CANDIDATE_HEAD_MISMATCH",
    );
    const noMergeEvidence = {
      ...merged,
      pull: { ...merged.pull, merged_at: null },
    };
    expect(() => authorizeCandidate(noMergeEvidence)).toThrow(
      "CANDIDATE_HEAD_MISMATCH",
    );
  });
  it("rejects mutable refs, stale head approvals and self approval", () => {
    expect(() => authorizeCandidate({ ...fixture(), sha: "Calender" })).toThrow(
      "INVALID_CANDIDATE_SHA",
    );
    const stale = fixture();
    stale.pull.head.sha = "b".repeat(40);
    expect(() => authorizeCandidate(stale)).toThrow("CANDIDATE_HEAD_MISMATCH");
    const oldReview = fixture();
    oldReview.reviews[0].commit_id = "b".repeat(40);
    expect(() => authorizeCandidate(oldReview)).toThrow("REVIEW_REQUIRED");
    const self = fixture();
    self.pull.user.login = "reviewer";
    expect(() => authorizeCandidate(self)).toThrow("REVIEW_REQUIRED");
  });
  it("rejects dismissed, unauthorized and change-requesting reviews", () => {
    for (const state of ["DISMISSED", "CHANGES_REQUESTED"]) {
      const input = fixture();
      input.reviews.push({ ...input.reviews[0], state });
      expect(() => authorizeCandidate(input)).toThrow("REVIEW_REQUIRED");
    }
    const input = fixture();
    input.permissions.reviewer = "read";
    expect(() => authorizeCandidate(input)).toThrow("REVIEW_REQUIRED");
  });
  it("rejects a newer failed or unfinished CI run", () => {
    for (const conclusion of ["failure", "cancelled", ""]) {
      const input = fixture();
      input.runs.push({ ...input.runs[0], id: 100, conclusion });
      expect(() => authorizeCandidate(input)).toThrow("CANDIDATE_CI_REQUIRED");
    }
  });
  it("blocks authentication on wrong release, bridge, or changed Worker version", async () => {
    const good = {
      sourceSha: sha,
      runtime: "cloudflare-workers",
      legacyBackendBridge: false,
      workerVersion: "version-one",
    };
    for (const patch of [
      { sourceSha: "b".repeat(40) },
      { legacyBackendBridge: true },
      { workerVersion: "version-two" },
    ]) {
      const request = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ ...good, ...patch })));
      await expect(
        verifyStagingIdentity(
          { EXPECTED_RELEASE_SHA: sha, EXPECTED_WORKER_VERSION: "version-one" },
          request,
        ),
      ).rejects.toThrow("AUTHENTICATION_BLOCKED");
      expect(request.mock.calls[0][1].redirect).toBe("error");
    }
    await expect(
      verifyStagingIdentity(
        { EXPECTED_RELEASE_SHA: sha, EXPECTED_WORKER_VERSION: "version-one" },
        vi.fn().mockResolvedValue(new Response(JSON.stringify(good))),
      ),
    ).resolves.toEqual(good);
  });
});
