import { readFileSync, writeFileSync, lstatSync } from "node:fs";
import ts from "typescript";
import { createHash } from "node:crypto";

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

export function assertCandidateRuntimeConfiguration(trusted, candidate) {
  const expected = JSON.stringify(canonical(runtimeShape(trusted)));
  const actual = JSON.stringify(canonical(runtimeShape(candidate)));
  if (expected !== actual)
    throw new Error("REVIEWED_RUNTIME_CONFIGURATION_MISMATCH");
  return createHash("sha256").update(expected).digest("hex");
}

export function prepareStagingConfiguration(input) {
  const config = structuredClone(input);
  delete config.$schema;
  delete config.build;
  for (const vars of [config.vars, config.env?.staging?.vars]) {
    if (vars) delete vars.LEGACY_BACKEND_ORIGIN;
  }
  config.compatibility_flags = [
    ...new Set([...(config.compatibility_flags ?? []), "nodejs_compat"]),
  ];
  config.observability = {
    enabled: true,
    logs: { enabled: true, invocation_logs: false },
    traces: { enabled: false },
  };
  const staging = config.env?.staging;
  if (!staging?.queues?.consumers || !staging.vars)
    throw new Error("TRUSTED_STAGING_BINDINGS_MISSING");
  staging.vars.ENABLE_GOOGLE_DELIVERY = "false";
  staging.triggers = { crons: ["* * * * *"] };
  for (const consumer of staging.queues.consumers) {
    consumer.max_retries = 5;
    if (consumer.queue === "calenderzw-push-staging") {
      consumer.max_batch_size = 1;
      consumer.max_concurrency = 1;
    }
  }
  if (
    !staging.queues.consumers.some(
      (consumer) => consumer.queue === "calenderzw-push-staging",
    )
  )
    throw new Error("TRUSTED_GOOGLE_QUEUE_MISSING");
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
  const config = prepareStagingConfiguration(parsed.config);
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
  const digest = assertCandidateRuntimeConfiguration(config, candidate.config);
  console.log(`Verified reviewed runtime configuration SHA256: ${digest}`);
  writeFileSync("staging-deploy.json", JSON.stringify(config));
}

if (process.argv[1]?.endsWith("prepare-staging-deployment.mjs")) main();
