import { readFile } from "node:fs/promises";

function parseJsonc(source) {
  return JSON.parse(source.replace(/,\s*([}\]])/g, "$1"));
}

const wrangler = parseJsonc(await readFile("wrangler.jsonc", "utf8"));
const worker = await readFile("worker/index.mjs", "utf8");

const requiredWorkerFirst = [
  "/api/*",
  "/calendar/*",
  "/runtime-config.js",
  "/sitemap.xml",
  "/__release",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Cloudflare foundation check failed: ${message}`);
  }
}

assert(wrangler.main === "./worker/index.mjs", "Worker entrypoint drifted.");
assert(
  wrangler.assets?.directory === "./dist/",
  "Static Assets must deploy the Vite dist directory.",
);
assert(
  wrangler.assets?.binding === "ASSETS",
  "Static Assets binding must remain ASSETS.",
);
assert(
  wrangler.assets?.not_found_handling === "single-page-application",
  "SPA navigation fallback must remain explicit.",
);

const workerFirst = wrangler.assets?.run_worker_first ?? [];
for (const route of requiredWorkerFirst) {
  assert(workerFirst.includes(route), `missing Worker-first route ${route}`);
}
assert(
  !workerFirst.some((route) => route === "/assets/*" || route === "/*"),
  "Static assets must not be forced through Worker compute.",
);

assert(
  worker.includes('url.pathname.startsWith("/assets/")'),
  "missing-assets guard is required.",
);
assert(
  worker.includes("return notFound();"),
  "missing assets must be able to return a real 404.",
);
assert(
  worker.includes("Browser HTML") &&
    worker.includes("NEVER proxied to Railway"),
  "the split-release SPA ownership invariant must be explicit in Worker code.",
);
assert(
  worker.includes("LEGACY_BACKEND_ORIGIN"),
  "staging backend bridge must be explicit and removable.",
);

const staging = wrangler.env?.staging;
assert(staging, "staging environment must exist.");
assert(
  staging.routes?.some(
    (route) =>
      route.pattern === "next.calender.aido.co.zw" &&
      route.custom_domain === true,
  ),
  "staging custom domain must remain isolated from production.",
);

const bucketMap = new Map(
  (staging.r2_buckets ?? []).map((bucket) => [\n    bucket.binding,\n    bucket.bucket_name,\n  ]),
);
assert(
  bucketMap.get("SOURCE_BUCKET") === "calenderzw-source-staging",
  "source R2 binding must point to the staging bucket.",
);
assert(
  bucketMap.get("CALENDAR_ARTIFACT_BUCKET") ===
    "calenderzw-calendar-artifacts-staging",
  "calendar artifact binding must point to the staging bucket.",
);

const queueMap = new Map(
  (staging.queues?.producers ?? []).map((producer) => [
    producer.binding,
    producer.queue,
  ]),
);
assert(
  queueMap.get("SOURCE_PROCESSING_QUEUE") ===
    "calenderzw-source-processing-staging",
  "source queue binding must remain staging-only.",
);
assert(
  queueMap.get("PUSH_QUEUE") === "calenderzw-push-staging",
  "push queue binding must remain staging-only.",
);

console.log(
  "Cloudflare foundation contract OK: atomic SPA assets, staging-only bindings, selective Worker routing, and missing-asset 404 guard are present.",
);
