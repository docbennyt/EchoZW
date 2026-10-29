import { createHash } from "node:crypto";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

function runtimeShape(input) {
  const config = structuredClone(input);
  for (const key of ["$schema", "main", "build", "no_bundle"])
    delete config[key];
  if (config.assets) delete config.assets.directory;
  return config;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

export function assertProductionRuntimeConfiguration(trusted, candidate) {
  const expected = JSON.stringify(canonical(runtimeShape(trusted)));
  const actual = JSON.stringify(canonical(runtimeShape(candidate)));
  if (expected !== actual)
    throw new Error("REVIEWED_PRODUCTION_CONFIGURATION_MISMATCH");
  return createHash("sha256").update(expected).digest("hex");
}

export function prepareProductionConfiguration(input) {
  const config = structuredClone(input);
  delete config.$schema;
  delete config.build;
  const production = config.env?.production;
  if (
    !production?.vars ||
    !production?.queues?.consumers ||
    !production?.queues?.producers ||
    !production?.r2_buckets
  )
    throw new Error("TRUSTED_PRODUCTION_BINDINGS_MISSING");
  if (
    production.routes?.length !== 1 ||
    production.routes[0]?.pattern !== "backend.calender.aido.co.zw" ||
    production.routes[0]?.custom_domain !== true
  )
    throw new Error("TRUSTED_PRODUCTION_ROUTE_MISSING");
  if (
    production.vars.APP_ENV !== "cloudflare-production" ||
    production.vars.PUBLIC_APP_URL !== "https://calender.aido.co.zw" ||
    production.vars.ENABLE_GOOGLE_DELIVERY !== "false" ||
    JSON.stringify(production).includes("-staging")
  )
    throw new Error("TRUSTED_PRODUCTION_ISOLATION_FAILED");
  const expectedQueues = [
    "calenderzw-source-processing-production",
    "calenderzw-push-production",
  ];
  if (
    !expectedQueues.every((name) =>
      production.queues.consumers.some((consumer) => consumer.queue === name),
    )
  )
    throw new Error("TRUSTED_PRODUCTION_BINDINGS_MISSING");
  production.triggers = { crons: ["* * * * *"] };
  for (const consumer of production.queues.consumers) {
    consumer.max_retries = 5;
    if (consumer.queue === "calenderzw-push-production") {
      consumer.max_batch_size = 1;
      consumer.max_concurrency = 1;
    }
  }
  config.compatibility_flags = [
    ...new Set([...(config.compatibility_flags ?? []), "nodejs_compat"]),
  ];
  config.observability = {
    enabled: true,
    logs: { enabled: true, invocation_logs: false },
    traces: { enabled: false },
  };
  config.main = "./candidate/bundle/index.js";
  config.assets.directory = "./candidate/dist";
  config.no_bundle = true;
  return config;
}

function main() {
  const parsed = ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  );
  if (parsed.error) throw new Error("TRUSTED_CONFIG_INVALID");
  for (const path of [
    "candidate",
    "candidate/bundle",
    "candidate/bundle/index.js",
    "candidate/dist",
  ]) {
    if (lstatSync(path).isSymbolicLink())
      throw new Error("CANDIDATE_SYMLINK_REJECTED");
  }
  const trusted = prepareProductionConfiguration(parsed.config);
  if (
    !/^[a-f0-9]{40}$/.test(process.env.CANDIDATE_SHA ?? "") ||
    !process.env.CANDIDATE_CONFIG_PATH
  )
    throw new Error("IMMUTABLE_CANDIDATE_CONFIG_REQUIRED");
  const candidateText = readFileSync(process.env.CANDIDATE_CONFIG_PATH, "utf8");
  if (Buffer.byteLength(candidateText) > 65536)
    throw new Error("CANDIDATE_CONFIG_TOO_LARGE");
  const candidate = ts.parseConfigFileTextToJson(
    "candidate-wrangler.jsonc",
    candidateText,
  );
  if (candidate.error || !candidate.config)
    throw new Error("CANDIDATE_CONFIG_INVALID");
  const digest = assertProductionRuntimeConfiguration(
    trusted,
    candidate.config,
  );
  console.log(`Verified reviewed production configuration SHA256: ${digest}`);
  writeFileSync("production-deploy.json", JSON.stringify(trusted));
}

if (process.argv[1]?.endsWith("prepare-production-deployment.mjs")) main();
