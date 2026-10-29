import { appendFileSync } from "node:fs";

// Capture the active version before deployment so rollback never rebuilds code.
const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/calenderzw-edge-production/deployments`,
  {
    headers: { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` },
    redirect: "error",
    signal: AbortSignal.timeout(15000),
  },
);
const body = await response.json();
const firstRelease =
  response.status === 404 &&
  body?.errors?.some((error) => error.code === 10007);
if (!firstRelease && (!response.ok || body?.success === false))
  throw new Error("PRODUCTION_ROLLBACK_LOOKUP_FAILED");
const active = (body?.deployments ?? body?.result?.deployments)?.[0];
const version = active?.versions?.[0]?.version_id;
if (
  !firstRelease &&
  (active?.versions?.length !== 1 ||
    active.versions[0].percentage !== 100 ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(version ?? ""))
)
  throw new Error("PRODUCTION_ROLLBACK_VERSION_UNCERTAIN");
appendFileSync(
  process.env.GITHUB_STEP_SUMMARY,
  firstRelease
    ? "\n- First production release: no previous Worker version. Public Vercel routing remains the rollback boundary.\n"
    : `\n- Previous production Worker version: \`${version}\`\n- Rollback before public cutover: \`npx wrangler@4.147.0 rollback ${version} --env production\` using the protected production credentials.\n`,
);
