import { spawnSync } from "node:child_process";

const origin = new URL(
  process.env.CALENDERZW_STAGING_ORIGIN ?? "https://next.calender.aido.co.zw",
);
const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA;
const diagnosticFeedUrl = process.env.CALENDERZW_STAGING_FEED_URL;
const checks = [];
const failures = [];

function redact(value) {
  return String(value).replace(
    /\/calendar\/feed\/[^/?#\s]+\.ics/g,
    "/calendar/feed/<redacted-token>.ics",
  );
}

function record(name, response, extra = {}) {
  const entry = {
    name,
    url: redact(response.url),
    status: response.status,
    contentType: response.headers.get("content-type") ?? "missing",
    cacheControl: response.headers.get("cache-control") ?? "missing",
    ...extra,
  };
  checks.push(entry);
  console.log(JSON.stringify(entry));
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${redact(message)}`);
}

function stagingUrl(pathname) {
  return new URL(pathname, origin);
}

async function get(pathname, headers = {}) {
  return fetch(stagingUrl(pathname), {
    headers: {
      "User-Agent": "CalenderZW-Cloudflare-Staging-Smoke/1.0",
      ...headers,
    },
    redirect: "manual",
  });
}

async function expectHtml(pathname, name) {
  const response = await get(pathname, {
    Accept: "text/html,application/xhtml+xml",
    "Sec-Fetch-Mode": "navigate",
  });
  const body = await response.text();
  record(name, response, { bytes: body.length });
  if (response.status !== 200) fail(`${name} returned ${response.status}.`);
  if (!/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    fail(`${name} did not return text/html.`);
  }
  if (!body.includes('id="root"')) {
    fail(`${name} did not return the Vite SPA shell.`);
  }
  return body;
}

async function expectAsset(pathname, expectedType, name) {
  const response = await get(pathname);
  const body = await response.text();
  record(name, response, { bytes: body.length });
  if (response.status !== 200) fail(`${name} returned ${response.status}.`);
  if (
    !new RegExp(`^${expectedType.replace("/", "\\/")}(?:;|$)`, "i").test(
      response.headers.get("content-type") ?? "",
    )
  ) {
    fail(`${name} did not return ${expectedType}.`);
  }
}

async function expectNotHtml404(pathname, name) {
  const response = await get(pathname);
  const body = await response.text();
  record(name, response, { bytes: body.length });
  if (response.status !== 404) fail(`${name} returned ${response.status}.`);
  if (/^text\/html(?:;|$)/i.test(response.headers.get("content-type") ?? "")) {
    fail(`${name} returned text/html.`);
  }
  if (/<html|<!doctype|id="root"|\/assets\/index-/i.test(body)) {
    fail(`${name} returned SPA HTML content.`);
  }
}

function extractAsset(html, extension) {
  const pattern = new RegExp(
    String.raw`(?:src|href)="([^"]*\/assets\/[^"]+\.${extension})"`,
  );
  const match = html.match(pattern);
  if (!match) {
    fail(`Could not find hashed .${extension} asset in staging HTML.`);
    return null;
  }
  return match[1];
}

const html = await expectHtml("/", "root");
await expectHtml("/find", "find");
await expectHtml("/t/ise-part-4-1-august-semester-2026", "known timetable");

const jsAsset = extractAsset(html, "js");
const cssAsset = extractAsset(html, "css");
if (jsAsset) await expectAsset(jsAsset, "text/javascript", "hashed JS");
if (cssAsset) await expectAsset(cssAsset, "text/css", "hashed CSS");

await expectNotHtml404(
  "/assets/calenderzw-definitely-missing.js",
  "missing hashed JS",
);
await expectNotHtml404(
  "/calendar/feed/calenderzw-diagnostic-invalid-token.ics",
  "invalid calendar feed",
);
await expectNotHtml404(
  "/calendar/download/calenderzw-diagnostic-invalid-token.ics",
  "invalid calendar download",
);

const release = await get("/__release", { Accept: "application/json" });
const releaseText = await release.text();
record("__release", release, { body: releaseText.slice(0, 500) });
if (release.status !== 200) fail("__release did not return 200.");
let releaseJson = null;
try {
  releaseJson = JSON.parse(releaseText);
} catch {
  fail("__release did not return JSON.");
}
if (releaseJson?.runtime !== "cloudflare-workers") {
  fail("__release runtime is not cloudflare-workers.");
}
if (
  expectedReleaseSha &&
  !JSON.stringify(releaseJson ?? {}).includes(expectedReleaseSha)
) {
  fail(`__release did not include expected SHA ${expectedReleaseSha}.`);
}

const runtimeConfig = await get("/runtime-config.js", {
  Accept: "application/javascript,*/*",
});
const runtimeConfigText = await runtimeConfig.text();
record("runtime-config", runtimeConfig, { bytes: runtimeConfigText.length });
if (runtimeConfig.status !== 200) fail("runtime-config did not return 200.");
if (
  /SERVICE_ROLE|SECRET|PRIVATE|TOKEN_ENCRYPTION|CLIENT_SECRET/i.test(
    runtimeConfigText,
  )
) {
  fail("runtime-config appears to expose private configuration.");
}

const health = await get("/api/health/live", { Accept: "application/json" });
const healthText = await health.text();
record("api health live", health, { body: healthText.slice(0, 500) });
if (health.status !== 200) fail("api health live did not return 200.");

if (diagnosticFeedUrl) {
  const result = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "calendar:diagnose"],
    {
      env: {
        ...process.env,
        CALENDERZW_FEED_HOST: origin.hostname,
        CALENDERZW_FEED_URL: diagnosticFeedUrl,
      },
      encoding: "utf8",
    },
  );
  process.stdout.write(redact(result.stdout));
  process.stderr.write(redact(result.stderr));
  if (result.status !== 0) {
    fail("authorized staging calendar diagnostic failed.");
  }
} else {
  console.log(
    "Authorized staging calendar feed diagnostic skipped: CALENDERZW_STAGING_FEED_URL is not set.",
  );
}

if (failures.length > 0) {
  console.error(
    `Cloudflare staging smoke failed with ${failures.length} issue(s).`,
  );
  process.exit(1);
}

console.log(
  `PASS: Cloudflare staging smoke passed for ${origin.origin} with ${checks.length} HTTP checks.`,
);
