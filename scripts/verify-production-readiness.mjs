#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PUBLIC_TIMETABLE_SLUG = "hit-ics-1-1-august-semester-2026";

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const options = {
    origin:
      env.CALENDERZW_SMOKE_ORIGIN ??
      env.PUBLIC_APP_URL ??
      env.VITE_PUBLIC_APP_URL,
    timetableSlug:
      env.CALENDERZW_SMOKE_TIMETABLE_SLUG ?? DEFAULT_PUBLIC_TIMETABLE_SLUG,
    adminBearerToken: env.CALENDERZW_SMOKE_ADMIN_BEARER_TOKEN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--origin" && next) {
      options.origin = next;
      index += 1;
    } else if (arg === "--timetable-slug" && next) {
      options.timetableSlug = next;
      index += 1;
    } else if (arg === "--admin-bearer-token" && next) {
      options.adminBearerToken = next;
      index += 1;
    } else if (arg === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function normalizeOrigin(origin) {
  if (!origin) {
    throw new Error(
      "Set CALENDERZW_SMOKE_ORIGIN or pass --origin https://calender.aido.co.zw.",
    );
  }
  const parsed = new URL(origin);
  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function fetchJson(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, {
    redirect: "manual",
    ...init,
    headers: {
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  return { response, body };
}

export async function runReadinessSmoke(options, fetchImpl = fetch) {
  const origin = normalizeOrigin(options.origin);
  const results = [];

  const ready = await fetchJson(fetchImpl, `${origin}/api/health/ready`);
  results.push({
    route: "/api/health/ready",
    status: ready.response.status,
    ok:
      ready.response.status === 200 &&
      ready.body?.status === "ready" &&
      ready.body?.dependencies?.schema === "ok",
  });

  const publicTimetable = await fetchJson(
    fetchImpl,
    `${origin}/api/public/timetables/${encodeURIComponent(options.timetableSlug)}`,
  );
  results.push({
    route: "/api/public/timetables/:slug",
    status: publicTimetable.response.status,
    ok:
      publicTimetable.response.status === 200 &&
      Boolean(publicTimetable.body?.timetable?.publicSlug),
  });

  const sessionHeaders = options.adminBearerToken
    ? { authorization: `Bearer ${options.adminBearerToken}` }
    : {};
  const adminSession = await fetchJson(
    fetchImpl,
    `${origin}/api/admin/session`,
    {
      headers: sessionHeaders,
    },
  );
  const expectedSessionStatuses = options.adminBearerToken ? [200] : [401, 403];
  results.push({
    route: "/api/admin/session",
    status: adminSession.response.status,
    ok: expectedSessionStatuses.includes(adminSession.response.status),
    mode: options.adminBearerToken ? "authenticated" : "unauthenticated",
  });

  return {
    origin,
    timetableSlug: options.timetableSlug,
    ok: results.every((result) => result.ok),
    results,
  };
}

export function formatSmokeResult(result) {
  return [
    `CalenderZW readiness smoke for ${result.origin}`,
    `Timetable canary: ${result.timetableSlug}`,
    ...result.results.map(
      (entry) =>
        `${entry.ok ? "PASS" : "FAIL"} ${entry.route} status=${entry.status}${
          entry.mode ? ` mode=${entry.mode}` : ""
        }`,
    ),
  ].join("\n");
}

function printHelp() {
  console.log(`Usage: node scripts/verify-production-readiness.mjs --origin https://calender.aido.co.zw

Environment:
  CALENDERZW_SMOKE_ORIGIN              Candidate deployment origin.
  CALENDERZW_SMOKE_TIMETABLE_SLUG      Published public timetable canary slug.
  CALENDERZW_SMOKE_ADMIN_BEARER_TOKEN  Optional admin token for a 200 session check.
`);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const options = parseArgs();
    if (options.help) {
      printHelp();
      process.exit(0);
    }
    const result = await runReadinessSmoke(options);
    console.log(formatSmokeResult(result));
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
