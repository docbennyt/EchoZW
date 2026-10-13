import { spawnSync } from "node:child_process";

const origin = new URL(
  process.env.CALENDERZW_STAGING_ORIGIN ?? "https://next.calender.aido.co.zw",
);
const expectedReleaseSha = process.env.EXPECTED_RELEASE_SHA;
const expectedBackendSha = process.env.EXPECTED_BACKEND_SHA;
const diagnosticFeedUrl = process.env.CALENDERZW_STAGING_FEED_URL;
const edgeSourceUploadSecret = process.env.CALENDERZW_EDGE_SOURCE_UPLOAD_SECRET;
const adminAccessToken = process.env.CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN;
const checks = [];
const failures = [];
const releasePropagationTimeoutMs = Number(
  process.env.CALENDERZW_RELEASE_WAIT_TIMEOUT_MS ?? 90_000,
);
const releasePropagationPollMs = Number(
  process.env.CALENDERZW_RELEASE_WAIT_POLL_MS ?? 3_000,
);

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readReleaseIdentity() {
  const response = await get("/__release", { Accept: "application/json" });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // The caller records and validates the final response.
  }
  return { response, text, json };
}

async function waitForExpectedReleaseIdentity() {
  if (!expectedReleaseSha) return readReleaseIdentity();

  const startedAt = Date.now();
  let last = await readReleaseIdentity();
  while (
    last.response.status === 200 &&
    last.json?.sourceSha !== expectedReleaseSha &&
    Date.now() - startedAt < releasePropagationTimeoutMs
  ) {
    console.log(
      JSON.stringify({
        name: "__release propagation wait",
        expectedSourceSha: expectedReleaseSha,
        observedSourceSha: last.json?.sourceSha ?? null,
        workerVersion: last.json?.workerVersion ?? null,
      }),
    );
    await sleep(releasePropagationPollMs);
    last = await readReleaseIdentity();
  }
  return last;
}

const {
  response: release,
  text: releaseText,
  json: releaseJson,
} = await waitForExpectedReleaseIdentity();
record("__release", release, { body: releaseText.slice(0, 500) });
if (release.status !== 200) fail("__release did not return 200.");
if (!releaseJson) {
  fail("__release did not return JSON.");
}
if (releaseJson?.runtime !== "cloudflare-workers") {
  fail("__release runtime is not cloudflare-workers.");
}
if (releaseJson?.stage !== "cloudflare-staging") {
  fail("__release stage is not cloudflare-staging.");
}
if (expectedReleaseSha && releaseJson?.sourceSha !== expectedReleaseSha) {
  fail(`__release did not include expected SHA ${expectedReleaseSha}.`);
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

async function postDocx(pathname, headers = {}) {
  return fetch(stagingUrl(pathname), {
    method: "POST",
    headers: {
      "User-Agent": "CalenderZW-Cloudflare-Staging-Smoke/1.0",
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "X-CalenderZW-Filename": "cloudflare-auth-smoke.docx",
      ...headers,
    },
    body: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
    redirect: "manual",
  });
}

async function expectAuthenticatedSourceUploadWorkflow() {
  const unauthorized = await postDocx("/api/edge/source-documents");
  const unauthorizedText = await unauthorized.text();
  record("edge source upload without auth", unauthorized, {
    body: unauthorizedText.slice(0, 300),
  });
  if (unauthorized.status !== 401) {
    fail(
      `edge source upload without auth returned ${unauthorized.status}, expected 401.`,
    );
  }

  if (!edgeSourceUploadSecret) {
    fail(
      "CALENDERZW_EDGE_SOURCE_UPLOAD_SECRET is required for the authenticated source upload smoke.",
    );
    return;
  }

  const authorized = await postDocx("/api/edge/source-documents", {
    Authorization: `Bearer ${edgeSourceUploadSecret}`,
  });
  const authorizedText = await authorized.text();
  record("edge source upload with auth", authorized, {
    body: authorizedText
      .replace(/source-documents\/[^"]+/g, "source-documents/<redacted>")
      .slice(0, 500),
  });
  let json = null;
  try {
    json = JSON.parse(authorizedText);
  } catch {
    fail("edge source upload with auth did not return JSON.");
  }
  if (authorized.status !== 202) {
    fail(`edge source upload with auth returned ${authorized.status}.`);
  }
  if (!json?.document?.queued || !json?.document?.sha256) {
    fail("edge source upload did not prove R2 write plus queue dispatch.");
  }
}

async function expectNativeAdminSessionBoundary() {
  const anonymous = await get("/api/admin/session", {
    Accept: "application/json",
  });
  const anonymousText = await anonymous.text();
  record("admin session without auth", anonymous, {
    body: anonymousText.slice(0, 300),
  });
  if (anonymous.status !== 401) {
    fail(
      `admin session without auth returned ${anonymous.status}, expected 401.`,
    );
  }

  if (!adminAccessToken) {
    console.log(
      "Authenticated admin session canary skipped: CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN is not set.",
    );
    return;
  }

  const authenticated = await get("/api/admin/session", {
    Accept: "application/json",
    Authorization: `Bearer ${adminAccessToken}`,
  });
  const authenticatedText = await authenticated.text();
  record("admin session with auth", authenticated, {
    body: authenticatedText
      .replace(/"email":"[^"]+"/g, '"email":"<redacted>"')
      .slice(0, 500),
  });
  if (authenticated.status !== 200) {
    fail(`admin session with auth returned ${authenticated.status}.`);
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
  "/calendar/download/00000000-0000-4000-8000-000000000000.ics",
  "invalid calendar download",
);

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

await expectAuthenticatedSourceUploadWorkflow();
await expectNativeAdminSessionBoundary();

const backendRelease = await get("/api/health/release", {
  Accept: "application/json",
});
const backendReleaseText = await backendRelease.text();
record("backend release identity", backendRelease, {
  body: backendReleaseText.slice(0, 500),
});
let backendReleaseJson = null;
if (backendRelease.status === 200) {
  try {
    backendReleaseJson = JSON.parse(backendReleaseText);
  } catch {
    fail("backend release identity did not return JSON.");
  }
  if (!backendReleaseJson?.sourceSha) {
    fail("backend release identity did not include a source SHA.");
  }
  if (
    expectedBackendSha &&
    backendReleaseJson?.sourceSha !== expectedBackendSha
  ) {
    fail(
      `backend release identity did not include expected SHA ${expectedBackendSha}.`,
    );
  }
} else if (expectedBackendSha) {
  fail(
    "backend release identity is unavailable while EXPECTED_BACKEND_SHA is required.",
  );
} else {
  console.log(
    "Backend integration compatibility not asserted: /api/health/release is unavailable on the bridged legacy backend.",
  );
}

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
  `PASS: Cloudflare staging smoke passed for ${origin.origin} with ${checks.length} HTTP checks. Backend compatibility ${
    backendReleaseJson?.sourceSha
      ? `reported ${backendReleaseJson.sourceSha}`
      : "was not asserted"
  }.`,
);
