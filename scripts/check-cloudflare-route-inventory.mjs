import { readFile } from "node:fs/promises";

const inventory = JSON.parse(
  await readFile("docs/DR-153_ROUTE_INVENTORY.json", "utf8"),
);
const worker = await readFile("worker/index.mjs", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Cloudflare route inventory check failed: ${message}`);
  }
}

const routes = inventory.routes ?? [];
assert(routes.length > 0, "inventory must contain routes.");

const requiredFields = [
  "method",
  "path",
  "authPolicy",
  "applicationService",
  "databaseDependencies",
  "nodeOnlyDependencies",
  "backgroundDependencies",
  "cloudflareStatus",
  "contractTests",
  "lastProvenRuntime",
  "remainingBlocker",
];

for (const [index, route] of routes.entries()) {
  for (const field of requiredFields) {
    assert(field in route, `route ${index} is missing ${field}.`);
  }
}

const byPath = new Map(routes.map((route) => [route.path, route]));
for (const path of [
  "/api/public/timetables",
  "/api/public/timetables/:slug",
  "/calendar/feed/:token.ics",
  "/calendar/download/:subscriptionId.ics",
  "/api/edge/source-documents",
  "/api/admin/session",
  "/api/admin/timetables/:id/corrections*",
  "SOURCE_PROCESSING_QUEUE",
  "static raw cleanup",
]) {
  assert(byPath.has(path), `inventory is missing ${path}.`);
}

for (const literal of [
  'url.pathname === "/api/edge/source-documents"',
  'url.pathname === "/api/public/timetables"',
  'url.pathname.startsWith("/calendar/feed/")',
  'url.pathname.startsWith("/calendar/download/")',
  "LEGACY_BACKEND_ORIGIN",
  "assertSourceUploadAuth",
]) {
  assert(worker.includes(literal), `Worker source is missing ${literal}.`);
}

const nativeCount = routes.filter((route) =>
  String(route.cloudflareStatus).startsWith("native"),
).length;
const bridgedCount = routes.filter(
  (route) => route.cloudflareStatus === "bridged",
).length;
const staticCount = routes.filter(
  (route) => route.cloudflareStatus === "static-assets",
).length;

assert(nativeCount >= 10, "native route count unexpectedly low.");
assert(bridgedCount >= 10, "bridged route count unexpectedly low.");
assert(staticCount >= 3, "static asset route count unexpectedly low.");

console.log(
  `Cloudflare route inventory OK: ${nativeCount} native/native-if-configured, ${staticCount} static, ${bridgedCount} bridged.`,
);
