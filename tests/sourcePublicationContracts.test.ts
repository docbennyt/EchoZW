import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const persistenceSource = readFileSync(
  "server/sourceReconciliationPersistence.ts",
  "utf8",
);
const repositorySource = readFileSync(
  "server/sourcePublicationRepository.ts",
  "utf8",
);
const cliSource = readFileSync("server/sourcePublicationCli.ts", "utf8");
const reconciliationCliSource = readFileSync(
  "server/sourceReconciliationCli.ts",
  "utf8",
);

describe("guarded source publication contracts", () => {
  it("persists reconciliation only after the compare-only mutation and conservation proofs pass", () => {
    expect(persistenceSource).toContain(
      "if (!input.zeroMutationProof.noMutationsObserved)",
    );
    expect(persistenceSource).toContain("if (!input.invariants.noSilentLoss)");
    expect(persistenceSource).toContain("result_hash: resultHash");
    expect(persistenceSource).toContain("result_payload: resultPayload");
    expect(reconciliationCliSource).toContain(
      "persistVerifiedSourceReconciliation(result)",
    );
    expect(reconciliationCliSource).toContain("Verified reconciliation:");
  });

  it("loads and integrity-checks a persisted reconciliation rather than rerunning matching during publication", () => {
    expect(repositorySource).toContain(
      '.from("timetable_source_reconciliations")',
    );
    expect(repositorySource).toContain("hashCanonicalJson(result) !== resultHash");
    expect(repositorySource).toContain("buildSourcePublicationPlan(reconciliation)");
    expect(repositorySource).not.toContain(
      "reconcileSourceCandidatesToPublishedTimetable",
    );
  });

  it("persists one deterministic plan per reconciliation and rejects drift", () => {
    expect(repositorySource).toContain(
      '.eq("reconciliation_id", plan.reconciliationId)',
    );
    expect(repositorySource).toContain(
      '"SOURCE_PUBLICATION_PLAN_DRIFT"',
    );
    expect(repositorySource).toContain("plan_hash: plan.planHash");
    expect(repositorySource).toContain(
      "plan_payload: sourcePublicationPlanPayload(plan)",
    );
  });

  it("exposes a deliberate plan-first then exact-hash execute CLI", () => {
    expect(cliSource).toContain(
      "npm run source:publish -- plan <reconciliation-id>",
    );
    expect(cliSource).toContain(
      "npm run source:publish -- execute <publication-id> <exact-plan-hash> <actor-user-id>",
    );
    expect(cliSource).toContain("--approve-removal=");
    expect(cliSource).toContain('action: "review_before_execute"');
    expect(cliSource).toContain("expectedPlanHash");
  });
});
