import { persistVerifiedSourceReconciliation } from "./sourceReconciliationPersistence.js";
import { runSourceReconciliation } from "./sourceReconciliationRepository.js";

function printSection(title: string, value: unknown) {
  console.log(title);
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const sourceKey = process.argv[2]?.trim();
  const sourceCohortCode = process.argv[3]?.trim();
  if (!sourceKey || !sourceCohortCode) {
    throw new Error(
      "Usage: npm run source:reconcile -- <source-key> <source-cohort-code>",
    );
  }

  const result = await runSourceReconciliation({
    sourceCohortCode,
    sourceKey,
  });
  const persisted = await persistVerifiedSourceReconciliation(result);

  console.log(
    `Binding: ${result.binding.sourceKey} ${result.binding.sourceCohortCode} -> ${result.binding.targetPublicSlug} (${result.binding.targetAcademicPeriodName})`,
  );
  console.log(`Source snapshot: ${result.sourceSnapshotId}`);
  console.log(`Parse run: ${result.parseRunId}`);
  console.log(`Published version: ${result.publishedVersionId}`);
  console.log(`Verified reconciliation: ${persisted.id}`);
  console.log(`Reconciliation evidence hash: ${persisted.resultHash}`);
  console.log(`MATCHED ${result.summary.matched}`);
  console.log(`CHANGED ${result.summary.changed}`);
  console.log(`SOURCE ONLY ${result.summary.sourceOnly}`);
  console.log(`CURRENT ONLY ${result.summary.currentOnly}`);
  console.log(`AMBIGUOUS ${result.summary.ambiguous}`);

  printSection(
    "CHANGED_ITEMS",
    result.items.filter((item) => item.outcome === "changed"),
  );
  printSection(
    "AMBIGUOUS_ITEMS",
    result.items.filter((item) => item.outcome === "ambiguous"),
  );
  printSection(
    "REPRESENTATIVE_MATCHED_ITEMS",
    result.items.filter((item) => item.outcome === "matched").slice(0, 5),
  );
  printSection(
    "REPRESENTATIVE_SOURCE_ONLY_ITEMS",
    result.items.filter((item) => item.outcome === "source_only").slice(0, 5),
  );
  printSection(
    "REPRESENTATIVE_CURRENT_ONLY_ITEMS",
    result.items.filter((item) => item.outcome === "current_only").slice(0, 5),
  );
  printSection("ZERO_MUTATION_PROOF", result.zeroMutationProof);
  printSection("VERIFIED_RECONCILIATION", persisted);
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: {
          code:
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "SOURCE_RECONCILIATION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
