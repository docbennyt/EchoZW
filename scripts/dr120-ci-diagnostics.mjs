import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const diagnosticsDir = resolve(root, ".dr120-ci");
mkdirSync(diagnosticsDir, { recursive: true });

const checks = [
  ["lint", ["run", "lint"]],
  ["format", ["run", "format:check"]],
  ["test", ["run", "test"]],
  ["build", ["run", "build"]],
];

const results = [];
for (const [name, args] of checks) {
  const result = spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  const output = [
    `$ npm ${args.join(" ")}`,
    `exit=${result.status ?? "null"}`,
    "",
    result.stdout ?? "",
    result.stderr ?? "",
    result.error ? `spawn error: ${result.error.stack ?? result.error.message}` : "",
  ].join("\n");
  writeFileSync(resolve(diagnosticsDir, `${name}.txt`), output, "utf8");
  results.push({ name, status: result.status ?? 1 });
}

mkdirSync(resolve(root, "dist"), { recursive: true });
const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const sections = results
  .map(({ name, status }) => {
    const log = readFileSync(resolve(diagnosticsDir, `${name}.txt`), "utf8");
    return `<section><h2>${name}: ${status === 0 ? "PASS" : `FAIL (${status})`}</h2><pre>${escapeHtml(log)}</pre></section>`;
  })
  .join("\n");
writeFileSync(
  resolve(root, "dist", "dr120-ci.html"),
  `<!doctype html><meta charset="utf-8"><title>DR-120 CI diagnostics</title><style>body{font-family:ui-monospace,monospace;margin:24px;max-width:1400px}pre{white-space:pre-wrap;background:#111;color:#eee;padding:16px;border-radius:8px}h2{margin-top:32px}</style><h1>DR-120 preview CI diagnostics</h1>${sections}`,
  "utf8",
);

// Intentionally exit 0 only for this temporary diagnostic preview. The next
// commit restores the normal production build command and removes this harness.
process.exit(0);
