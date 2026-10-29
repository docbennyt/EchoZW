import { readFile } from "node:fs/promises";

const production = process.argv.includes("--production");
const paths = [
  "worker/index.mjs",
  "wrangler.jsonc",
  ...(production ? ["vercel.json"] : []),
];
const failures = [];
for (const path of paths) {
  const source = await readFile(path, "utf8");
  for (const [index, line] of source.split("\n").entries()) {
    if (/LEGACY_BACKEND_ORIGIN|https?:\/\/[^\s"'`]*\.railway\.app/i.test(line))
      failures.push(`${path}:${index + 1}`);
  }
}
console.log(
  JSON.stringify({
    scope: production
      ? "active-production-and-worker"
      : "worker-candidate-only",
    checked: paths,
    retiredRuntimeDependencies: failures,
    productionCutoverProven: false,
  }),
);
if (failures.length) process.exitCode = 1;
