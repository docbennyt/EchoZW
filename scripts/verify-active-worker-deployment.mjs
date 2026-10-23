import { readFileSync, appendFileSync } from "node:fs";

const output = readFileSync("/tmp/reviewed-deploy.log", "utf8");
const version = output.match(/Current Version ID:\s*([a-f0-9-]{36})/)?.[1];
if (!version) throw new Error("DEPLOYMENT_VERSION_MISSING");
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-staging/deployments`,
  {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  },
);
const body = response.ok ? await response.json() : null;
const active = body?.result?.deployments?.[0];
if (
  !body?.success ||
  active?.versions?.length !== 1 ||
  active.versions[0].version_id !== version ||
  active.versions[0].percentage !== 100
)
  throw new Error("ACTIVE_DEPLOYMENT_VERSION_MISMATCH");
appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log(`Cloudflare API confirmed active Worker version ${version}`);
