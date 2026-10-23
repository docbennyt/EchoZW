// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  prepareStagingConfiguration,
  assertCandidateRuntimeConfiguration,
} from "../scripts/prepare-staging-deployment.mjs";

function sourceConfig() {
  return ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
}

describe("protected staging runtime prerequisites", () => {
  it("rejects runtime configuration drift while allowing inert bundle/asset path differences", () => {
    const trusted = prepareStagingConfiguration(sourceConfig());
    const candidate = structuredClone(trusted);
    candidate.main = "./worker/index.mjs";
    candidate.assets.directory = "./dist";
    expect(assertCandidateRuntimeConfiguration(trusted, candidate)).toMatch(
      /^[a-f0-9]{64}$/,
    );
    for (const tamper of [
      (config: typeof candidate) => {
        config.compatibility_flags = [];
      },
      (config: typeof candidate) => {
        config.env.staging.triggers.crons = [];
      },
      (config: typeof candidate) => {
        config.env.staging.vars.ENABLE_GOOGLE_DELIVERY = "true";
      },
      (config: typeof candidate) => {
        config.vars.LEGACY_BACKEND_ORIGIN = "https://retired.invalid";
      },
    ]) {
      const changed = structuredClone(candidate);
      tamper(changed);
      expect(() =>
        assertCandidateRuntimeConfiguration(trusted, changed),
      ).toThrow("REVIEWED_RUNTIME_CONFIGURATION_MISMATCH");
    }
  });
  it("uses trusted runtime settings without accepting executable candidate configuration", () => {
    const original = sourceConfig();
    const before = structuredClone(original);
    const prepared = prepareStagingConfiguration(original);
    expect(original).toEqual(before);
    expect(prepared.compatibility_date).toBe(original.compatibility_date);
    expect(prepared.compatibility_flags).toContain("nodejs_compat");
    expect(prepared.main).toBe("./candidate/bundle/index.js");
    expect(prepared.assets.directory).toBe("./candidate/dist");
    expect(prepared.no_bundle).toBe(true);
    expect(prepared.build).toBeUndefined();
    expect(prepared.vars.LEGACY_BACKEND_ORIGIN).toBeUndefined();
    expect(prepared.env.staging.vars.LEGACY_BACKEND_ORIGIN).toBeUndefined();
    expect(prepared.env.staging.vars.ENABLE_GOOGLE_DELIVERY).toBe("false");
    expect(prepared.env.staging.routes).toEqual(original.env.staging.routes);
    expect(prepared.env.staging.triggers.crons).toEqual(["* * * * *"]);
    expect(prepared.env.staging.queues.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: "calenderzw-source-processing-staging",
          max_retries: 5,
        }),
        expect.objectContaining({
          queue: "calenderzw-push-staging",
          max_retries: 5,
          max_batch_size: 1,
          max_concurrency: 1,
        }),
      ]),
    );
    expect(prepared.observability.logs.invocation_logs).toBe(false);
    expect(prepared.observability.traces.enabled).toBe(false);
  });
  it("fails closed if staging or Google queue binding is absent", () => {
    expect(() => prepareStagingConfiguration({})).toThrow(
      "TRUSTED_STAGING_BINDINGS_MISSING",
    );
    const config = sourceConfig();
    config.env.staging.queues.consumers = [];
    expect(() => prepareStagingConfiguration(config)).toThrow(
      "TRUSTED_GOOGLE_QUEUE_MISSING",
    );
  });
  it("places ephemeral PostgreSQL only in secretless candidate packaging", () => {
    const workflow = readFileSync(
      ".github/workflows/cloudflare-staging.yml",
      "utf8",
    );
    const packaging = workflow.split("  package:")[1].split("  deploy:")[0];
    expect(packaging).toContain("image: postgres:17");
    expect(packaging).toContain("15478:5432");
    expect(packaging).toContain('DR178_REQUIRE_POSTGRES: "true"');
    expect(packaging).not.toContain("secrets.");
    expect(packaging).not.toContain("environment:");
    expect(workflow.match(/environment: cloudflare-staging/g)).toHaveLength(2);
    expect(workflow).toContain("github.ref == 'refs/heads/Calender'");
    expect(workflow).toContain("Recheck approval after environment review");
    expect(workflow).toContain("--no-bundle");
  });
});
