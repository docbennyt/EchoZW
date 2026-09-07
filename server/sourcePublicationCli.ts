import {
  createGuardedSourcePublicationPlan,
  executeGuardedSourcePublication,
} from "./sourcePublicationRepository.js";

function usage() {
  return [
    "Guarded source publication is deliberately two-step:",
    "  npm run source:publish -- plan <reconciliation-id>",
    "  npm run source:publish -- execute <publication-id> <exact-plan-hash> <actor-user-id> [--approve-removal=<session-id> ...]",
    "",
    "Always review the persisted plan output before execute. Every current-only removal",
    "must be approved by exact session id; ambiguous/blocked plans cannot execute.",
  ].join("\n");
}

function print(value: unknown) {
  console.log(JSON.stringify(value, null, 2));
}

function approvedRemovalIds(args: string[]) {
  return args.map((argument) => {
    const prefix = "--approve-removal=";
    if (!argument.startsWith(prefix) || !argument.slice(prefix.length).trim()) {
      throw new Error(`Unknown execution argument: ${argument}\n${usage()}`);
    }
    return argument.slice(prefix.length).trim();
  });
}

async function plan(reconciliationId: string) {
  const persisted = await createGuardedSourcePublicationPlan(reconciliationId);
  print({
    action: "review_before_execute",
    blockers: persisted.plan.blockers,
    cohort: persisted.plan.cohort,
    operations: persisted.plan.operations,
    parseRunId: persisted.plan.parseRunId,
    persistence: persisted.persistence,
    planHash: persisted.plan.planHash,
    policy: persisted.plan.policy,
    previousPublishedVersionId:
      persisted.plan.previousPublishedVersionId,
    publicationId: persisted.id,
    reconciliationId: persisted.plan.reconciliationId,
    removalSessionIds: persisted.plan.removalSessionIds,
    sourceSnapshotId: persisted.plan.sourceSnapshotId,
    status: persisted.status,
    summary: persisted.plan.summary,
    timetableId: persisted.plan.timetableId,
    warnings: persisted.plan.warnings,
  });
}

async function execute(args: string[]) {
  const publicationId = args[0]?.trim();
  const expectedPlanHash = args[1]?.trim();
  const actorId = args[2]?.trim();
  if (!publicationId || !expectedPlanHash || !actorId) {
    throw new Error(usage());
  }

  const result = await executeGuardedSourcePublication({
    actorId,
    approvedRemovalSessionIds: approvedRemovalIds(args.slice(3)),
    expectedPlanHash,
    publicationId,
  });
  print({
    action: result.idempotentReplay
      ? "idempotent_publication_replay"
      : "published",
    ...result,
  });
}

async function main() {
  const command = process.argv[2]?.trim();
  if (command === "plan") {
    const reconciliationId = process.argv[3]?.trim();
    if (!reconciliationId) throw new Error(usage());
    await plan(reconciliationId);
    return;
  }
  if (command === "execute") {
    await execute(process.argv.slice(3));
    return;
  }
  throw new Error(usage());
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: {
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "SOURCE_PUBLICATION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
