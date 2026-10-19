import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildInventory,
  renderMarkdown,
} from "./generate-cloudflare-route-inventory.mjs";

const root = new URL("../", import.meta.url);
const inventory = JSON.parse(
  await readFile(new URL("docs/DR-153_ROUTE_INVENTORY.json", root), "utf8"),
);
const expected = await buildInventory(inventory);
const changedSources = Object.keys(expected.sourceSnapshot).filter(
  (file) => inventory.sourceSnapshot?.[file] !== expected.sourceSnapshot[file],
);
assert(
  JSON.stringify(inventory) === JSON.stringify(expected),
  `Source/route inventory drift${changedSources.length ? ` (${changedSources.join(", ")})` : ""}: run node scripts/generate-cloudflare-route-inventory.mjs and review changes.`,
);
assert.equal(
  await readFile(new URL("docs/DR-153_ROUTE_INVENTORY.md", root), "utf8"),
  await renderMarkdown(expected),
  "Markdown inventory drift; regenerate.",
);
const seen = new Set();
const required = [
  "authPolicy",
  "businessOwner",
  "applicationService",
  "databaseDependencies",
  "externalDependencies",
  "nodeOnlyDependencies",
  "backgroundDependencies",
  "cloudflareStatus",
  "contractTests",
  "lastProvenRuntime",
  "lastLiveRuntime",
  "lastLiveOutcome",
  "remainingBlocker",
  "sourceEvidence",
];
for (const route of inventory.routes) {
  const id = `${route.method} ${route.path.replace(/:[A-Za-z][A-Za-z0-9]*/g, ":param")}`;
  assert(!seen.has(id), `Duplicate concrete route: ${id}`);
  seen.add(id);
  assert(
    /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(route.method),
    `Non-concrete HTTP method: ${id}`,
  );
  assert(
    route.path.startsWith("/") && !/[*|?()]/.test(route.path),
    `Route family cannot count as concrete inventory: ${id}`,
  );
  for (const field of required)
    assert(field in route, `${id} missing ${field}`);
  assert(route.sourceEvidence.length, `${id} missing source evidence`);
  for (const e of route.sourceEvidence) {
    const lines = (await readFile(new URL(e.file, root), "utf8")).split(
      "\n",
    ).length;
    assert(
      Number.isInteger(e.line) && e.line > 0 && e.line <= lines,
      `${id} invalid file/line evidence`,
    );
  }
  assert.equal(
    route.lastLiveRuntime,
    null,
    `${id}: generator cannot manufacture live proof`,
  );
  assert(route.remainingBlocker, `${id}: unproven route must retain blocker`);
}
assert.equal(
  inventory.counts.nativeLiveProven,
  0,
  "No live acceptance evidence supplied",
);
assert.equal(
  inventory.counts.nativeImplementedNotLiveProven,
  inventory.routes.filter(
    (r) => r.cloudflareStatus === "native-not-live-proven",
  ).length,
);
assert(
  !inventory.routes.some((r) => r.cloudflareStatus === "native"),
  "Native success requires deployed acceptance",
);
const subscription = inventory.routes.find(
  (r) => r.method === "POST" && r.path === "/api/calendar/subscriptions",
);
assert.equal(
  subscription.cloudflareStatus,
  "native-incomplete",
  "Provider parity remains partial",
);
assert.equal(
  subscription.providerVariants[0].cloudflareStatus,
  "native-not-live-proven",
);
assert.equal(subscription.providerVariants[1].httpStatus, 503);
assert.equal(
  subscription.providerVariants[1].errorCode,
  "GOOGLE_NOT_CONFIGURED",
);
const googleStatus = inventory.routes.find(
  (r) => r.method === "GET" && r.path === "/api/calendar/google/status",
);
assert.equal(googleStatus.cloudflareStatus, "native-not-live-proven");
assert.equal(googleStatus.responseContract.enabled, false);
assert.equal(
  inventory.routingState.workerRuntimeBridgePresent,
  false,
  "Worker runtime must not restore the legacy bridge",
);
assert.equal(
  inventory.routingState.workerConfigBridgePresent,
  false,
  "Worker configuration must not restore the legacy bridge",
);
if (process.argv.includes("--self-test")) {
  const file = "server/healthApi.ts";
  const source = await readFile(new URL(file, root), "utf8");
  const changed = source.replace(
    '"/api/health/live"',
    '"/api/health/live-inventory-drift-probe"',
  );
  assert.notEqual(
    source,
    changed,
    "Drift probe must change real dispatch source",
  );
  const drifted = await buildInventory(inventory, {
    sourceOverrides: new Map([[file, changed]]),
  });
  assert.notEqual(drifted.sourceSnapshot[file], inventory.sourceSnapshot[file]);
  assert(
    drifted.routes.some(
      (r) => r.path === "/api/health/live-inventory-drift-probe",
    ),
    "AST must discover added dispatch path",
  );
  assert.notEqual(
    JSON.stringify(drifted),
    JSON.stringify(inventory),
    "Checker comparison must reject source drift",
  );
  assert.equal(
    inventory.counts.nativeImplementedNotLiveProven +
      inventory.counts.nativeIncomplete +
      inventory.counts.intentionallyDisabled +
      inventory.counts.bridged +
      inventory.counts.unavailable,
    inventory.counts.httpRoutes,
    "Statuses partition HTTP routes without counting incomplete as native",
  );
  console.log(
    "In-memory drift probe passed; native-incomplete/disabled/bridged excluded from native counts. No files mutated.",
  );
}
console.log(
  `Cloudflare inventory consistent (not runtime acceptance): ${JSON.stringify(inventory.counts)}; ${Object.keys(inventory.sourceSnapshot).length} source fingerprints.`,
);
