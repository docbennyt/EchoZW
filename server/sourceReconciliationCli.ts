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

  console.log(`Binding: ${result.binding.sourceKey} ${result.binding.sourceCohortCode} -> ${result.binding.targetPublicSlug} (${result.binding.targetAcademicPeriodName})`);
  console.log(`Source snapshot: ${result.sourceSnapshotId}`);
  console.log(`Parse run: ${result.parseRunId}`);
  console.log(`Published version: ${result.publishedVersionId}`);
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
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: {
          code: "SOURCE_RECONCILIATION_ERROR",
          message: error instanceof Error ? error.message : String(error),
        },
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
