const origin = "https://backend.calender.aido.co.zw";
const expectedSha = process.env.EXPECTED_RELEASE_SHA;
const expectedVersion = process.env.EXPECTED_WORKER_VERSION;
if (!/^[a-f0-9]{40}$/.test(expectedSha ?? "") || !expectedVersion)
  throw new Error("PRODUCTION_IDENTITY_EXPECTATION_REQUIRED");

const failures = [];
const checks = [];
const json = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
async function check(name, path, validate) {
  try {
    const response = await fetch(new URL(path, origin), {
      redirect: "error",
      signal: AbortSignal.timeout(20000),
      headers: { "cache-control": "no-cache" },
    });
    const text = await response.text();
    const passed = validate(response, text);
    checks.push({ name, status: response.status, passed });
    if (!passed) failures.push(name);
  } catch {
    checks.push({ name, passed: false, error: "REQUEST_FAILED" });
    failures.push(name);
  }
}

await check("release identity", "/__release", (response, text) => {
  const value = json(text);
  return (
    response.status === 200 &&
    value?.runtime === "cloudflare-workers" &&
    value?.stage === "cloudflare-production" &&
    value?.sourceSha === expectedSha &&
    value?.workerVersion === expectedVersion &&
    value?.legacyBackendBridge === false &&
    value?.publicOrigin === "https://calender.aido.co.zw"
  );
});
await check(
  "database readiness",
  "/api/health/ready",
  (response, text) => response.status === 200 && json(text)?.status === "ready",
);
await check(
  "public timetable discovery",
  "/api/public/timetables",
  (response, text) =>
    response.status === 200 &&
    Array.isArray(json(text)?.timetables) &&
    json(text).timetables.length > 0 &&
    response.headers.get("x-calenderzw-edge-runtime") ===
      "cloudflare-native-public-api",
);
await check(
  "runtime config",
  "/runtime-config.js",
  (response, text) =>
    response.status === 200 &&
    /^text\/javascript/.test(response.headers.get("content-type") ?? "") &&
    text.includes("https://calender.aido.co.zw") &&
    !/SECRET_KEY|CLIENT_SECRET|TOKEN_ENCRYPTION|service[_-]?role/i.test(text),
);
await check(
  "anonymous admin denied",
  "/api/admin/session",
  (response) => response.status === 401,
);
await check(
  "Google globally disabled",
  "/api/calendar/google/status",
  (response, text) => response.status === 200 && json(text)?.enabled === false,
);
await check(
  "invalid feed is non-HTML",
  "/calendar/feed/calenderzw-production-invalid-token.ics",
  (response, text) =>
    response.status === 404 &&
    !/text\/html/.test(response.headers.get("content-type") ?? "") &&
    !text.includes('id="root"'),
);
await check(
  "unknown API fails explicitly",
  "/api/production-unimplemented",
  (response, text) =>
    response.status === 503 &&
    json(text)?.error?.code === "EDGE_ROUTE_UNAVAILABLE",
);

console.log(JSON.stringify({ origin, checks, failures }, null, 2));
if (failures.length) process.exitCode = 1;
