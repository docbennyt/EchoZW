// Read-only acceptance against the deployed runtime. Missing credentials are
// blocking evidence, never a skipped green check. Private URLs/tokens stay local.
import {
  obtainAcceptanceToken,
  validateRecoveryCalendar,
} from "./recovery-acceptance.mjs";
const origin =
  process.env.CALENDERZW_STAGING_ORIGIN ?? "https://next.calender.aido.co.zw";
const failures = [];
const report = [];
async function check(name, path, validate, init) {
  try {
    const response = await fetch(new URL(path, origin), {
      ...init,
      signal: AbortSignal.timeout(25000),
      redirect: "manual",
    });
    const body = await response.text();
    const passed = await validate(response, body);
    report.push({ name, status: response.status, passed });
    if (!passed) failures.push(name);
    return { response, body };
  } catch {
    failures.push(name);
    report.push({ name, passed: false, error: "REQUEST_FAILED" });
    return null;
  }
}
const asJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
await check("exact release without legacy bridge", "/__release", (r, text) => {
  const value = asJson(text);
  return (
    r.status === 200 &&
    value?.runtime === "cloudflare-workers" &&
    value.legacyBackendBridge === false &&
    Boolean(process.env.EXPECTED_RELEASE_SHA) &&
    value.sourceSha === process.env.EXPECTED_RELEASE_SHA
  );
});
await check(
  "backend identity",
  "/api/health/release",
  (r, text) =>
    r.status === 200 &&
    asJson(text)?.sourceSha === process.env.EXPECTED_RELEASE_SHA,
);
await check(
  "database readiness",
  "/api/health/ready",
  (r, text) => r.status === 200 && asJson(text)?.status === "ready",
);
await check(
  "native discovery",
  "/api/public/timetables",
  (r, text) =>
    r.status === 200 &&
    asJson(text)?.timetables?.length > 0 &&
    r.headers.get("x-calenderzw-edge-runtime") ===
      "cloudflare-native-public-api",
);
await check(
  "source and effective timetable",
  "/api/public/timetables/ise-part-4-1-august-semester-2026",
  (r, text) => {
    const t = asJson(text)?.timetable;
    const ise = (sessions, weekday) =>
      sessions?.filter(
        (s) => s.courseCode === "ISE4105" && s.weekday === weekday,
      );
    return (
      r.status === 200 &&
      t?.effectiveSessions?.length === 15 &&
      ise(t.sessions, 3)?.some((s) => s.startTime.startsWith("12:15")) &&
      ise(t.effectiveSessions, 2)?.some((s) =>
        s.startTime.startsWith("12:15"),
      ) &&
      ise(t.effectiveSessions, 4)?.some((s) =>
        s.startTime.startsWith("08:00"),
      ) &&
      !ise(t.effectiveSessions, 3)?.some((s) => s.startTime.startsWith("12:15"))
    );
  },
);
await check(
  "anonymous admin denied",
  "/api/admin/session",
  (r) => r.status === 401,
);
let adminToken;
try {
  adminToken = await obtainAcceptanceToken(process.env);
} catch (error) {
  failures.push(
    error.message === "TEST_ACCOUNT_AUTH_CONFIG_INVALID"
      ? "BLOCKED: TEST_ACCOUNT_AUTH_CONFIG_INVALID"
      : "BLOCKED: TEST_ACCOUNT_SIGN_IN_FAILED",
  );
}
if (!adminToken)
  failures.push("BLOCKED: CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN");
else {
  const init = { headers: { authorization: `Bearer ${adminToken}` } };
  await check(
    "authenticated staff session",
    "/api/admin/session",
    (r, text) =>
      r.status === 200 &&
      asJson(text)?.authenticated === true &&
      r.headers.get("cache-control") === "no-store",
    init,
  );
  for (const [path, property] of [
    ["institutions", "institutions"],
    ["programmes", "programmes"],
    ["class-groups", "classGroups"],
    ["academic-periods", "academicPeriods"],
    ["timetables", "timetables"],
  ])
    await check(
      `authenticated ${path}`,
      `/api/admin/${path}`,
      (r, text) =>
        r.status === 200 &&
        Array.isArray(asJson(text)?.[property]) &&
        r.headers.get("cache-control") === "no-store",
      init,
    );
}
const feedUrl = process.env.CALENDERZW_STAGING_FEED_URL;
if (!feedUrl)
  failures.push("BLOCKED: CALENDERZW_STAGING_FEED_URL (original subscription)");
else {
  let original;
  try {
    original = new URL(feedUrl);
  } catch {
    failures.push("Invalid diagnostic feed URL");
  }
  // Never send a private path/token to a redirect or third-party origin.
  if (
    !original ||
    original.username ||
    original.password ||
    original.search ||
    original.hash ||
    !/^\/calendar\/feed\/[^/]+\.ics$/.test(original.pathname)
  )
    failures.push("Invalid diagnostic feed path");
  else {
    let expectedCalendar;
    const slug = process.env.CALENDERZW_STAGING_FEED_TIMETABLE_SLUG;
    if (!slug || !/^[a-z0-9-]+$/.test(slug))
      failures.push("BLOCKED: CALENDERZW_STAGING_FEED_TIMETABLE_SLUG");
    else {
      const baseline = await check(
        "original feed published class baseline",
        `/api/public/timetables/${slug}`,
        (r, text) =>
          r.status === 200 &&
          asJson(text)?.timetable?.publicSlug === slug &&
          asJson(text)?.timetable?.effectiveSessions?.length > 0,
      );
      if (baseline?.response.status === 200) {
        const { generatePublishedTimetableIcs } =
          await import("../dist-server/server/publishedCalendar.js");
        expectedCalendar = generatePublishedTimetableIcs({
          timetable: asJson(baseline.body).timetable,
          reminderOffsetsMinutes: [],
          publicOrigin: "https://calender.aido.co.zw",
        });
      }
    }
    let calendarDiagnostic;
    const feed = await check(
      "original subscription feed",
      original.pathname,
      (r, text) =>
        r.status === 200 &&
        /^text\/calendar/.test(r.headers.get("content-type") ?? "") &&
        r.headers.get("cache-control")?.includes("private") &&
        Boolean(expectedCalendar) &&
        validateRecoveryCalendar(
          text,
          (code, count) => {
            calendarDiagnostic = {
              code,
              ...(count === undefined ? {} : { count }),
            };
          },
          expectedCalendar,
        ),
    );
    if (calendarDiagnostic)
      report.push({
        name: "original calendar diagnostic",
        ...calendarDiagnostic,
      });
    if (feed?.response.status === 200) {
      await check(
        "stale ETag refresh",
        original.pathname,
        (r) => r.status === 200,
        { headers: { "if-none-match": '"outage-stale-validator"' } },
      );
      const etag = feed.response.headers.get("etag");
      if (!etag) failures.push("feed ETag missing");
      else
        await check(
          "current ETag unchanged",
          original.pathname,
          (r) => r.status === 304,
          { headers: { "if-none-match": etag } },
        );
    }
  }
}
await check(
  "unknown API is explicit unavailable",
  "/api/recovery-unimplemented",
  (r, text) =>
    r.status === 503 && asJson(text)?.error?.code === "EDGE_ROUTE_UNAVAILABLE",
);
await check(
  "missing JS is non-HTML 404",
  "/assets/recovery-missing.js",
  (r, text) =>
    r.status === 404 &&
    !/text\/html/.test(r.headers.get("content-type") ?? "") &&
    !text.includes('id="root"'),
);
console.log(
  JSON.stringify(
    {
      acceptance: "native-public-feed-staff-recovery",
      checks: report,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length) process.exitCode = 1;
