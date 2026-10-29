import { appendFileSync, readFileSync } from "node:fs";

const version =
  process.env.EXPECTED_WORKER_VERSION ||
  readFileSync("/tmp/production-deploy.log", "utf8").match(
    /Current Version ID:\s*([a-f0-9-]{36})/,
  )?.[1];
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(version ?? ""))
  throw new Error("PRODUCTION_DEPLOYMENT_VERSION_MISSING");
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-production/deployments`,
  {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  },
);
if (!response.ok)
  throw new Error(
    `PRODUCTION_DEPLOYMENT_LOOKUP_FAILED_HTTP_${response.status}`,
  );
const body = await response.json();
const active = (body?.deployments ?? body?.result?.deployments)?.[0];
if (
  body?.success === false ||
  (body?.errors?.length ?? 0) > 0 ||
  active?.versions?.length !== 1 ||
  active.versions[0].version_id !== version ||
  active.versions[0].percentage !== 100
)
  throw new Error("PRODUCTION_DEPLOYMENT_VERSION_MISMATCH");
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Cloudflare confirmed active production Worker version ${version}`);
