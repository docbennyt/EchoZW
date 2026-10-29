export function assertProductionEnvironment(environment) {
  const reviewers = environment?.protection_rules?.find(
    (rule) => rule.type === "required_reviewers",
  )?.reviewers;
  if (
    environment?.name !== "cloudflare-production" ||
    environment?.can_admins_bypass !== false ||
    !Array.isArray(reviewers) ||
    reviewers.length === 0
  )
    throw new Error("PRODUCTION_ENVIRONMENT_APPROVAL_REQUIRED");
  return true;
}

async function main() {
  const response = await fetch(
    "https://api.github.com/repos/docbennyt/EchoZW/environments/cloudflare-production",
    {
      headers: {
        authorization: `Bearer ${process.env.GH_TOKEN}`,
        accept: "application/vnd.github+json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!response.ok) throw new Error("PRODUCTION_ENVIRONMENT_LOOKUP_FAILED");
  assertProductionEnvironment(await response.json());
  console.log("Verified protected cloudflare-production approval policy.");
}

if (process.argv[1]?.endsWith("verify-production-environment.mjs"))
  await main();
