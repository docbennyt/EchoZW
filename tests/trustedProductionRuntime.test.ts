// @vitest-environment node
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { prepareProductionConfiguration } from "../scripts/prepare-production-deployment.mjs";
import { assertProductionEnvironment } from "../scripts/verify-production-environment.mjs";

function sourceConfig() {
  return ts.parseConfigFileTextToJson(
    "wrangler.jsonc",
    readFileSync("wrangler.jsonc", "utf8"),
  ).config;
}

describe("protected production backend prerequisites", () => {
  it("provisions the PostgreSQL role and port required by mandatory delivery contracts", () => {
    const workflow = readFileSync(
      ".github/workflows/cloudflare-production-gate.yml",
      "utf8",
    );
    expect(workflow).toContain("POSTGRES_USER: dr178");
    expect(workflow).toContain("pg_isready -U dr178 -d postgres");
    expect(workflow).toContain("15478:5432");
    expect(workflow).toContain('DR178_REQUIRE_POSTGRES: "true"');
  });
  it("keeps production isolated, Google delivery off, and a dedicated backend origin", () => {
    const original = sourceConfig();
    const prepared = prepareProductionConfiguration(original);

    expect(prepared.main).toBe("./candidate/bundle/index.js");
    expect(prepared.assets.directory).toBe("./candidate/dist");
    expect(prepared.no_bundle).toBe(true);
    expect(prepared.env.production.routes).toEqual([
      {
        pattern: "backend.calender.aido.co.zw",
        custom_domain: true,
      },
    ]);
    expect(prepared.env.production.vars).toMatchObject({
      APP_ENV: "cloudflare-production",
      PUBLIC_APP_URL: "https://calender.aido.co.zw",
      ENABLE_GOOGLE_DELIVERY: "false",
    });
    expect(JSON.stringify(prepared.env.production)).not.toContain("-staging");
    expect(prepared.env.production.triggers.crons).toEqual(["* * * * *"]);
    expect(prepared.env.production.queues.consumers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          queue: "calenderzw-source-processing-production",
          max_retries: 5,
        }),
        expect.objectContaining({
          queue: "calenderzw-push-production",
          max_retries: 5,
          max_batch_size: 1,
          max_concurrency: 1,
        }),
      ]),
    );
  });

  it("fails closed when production bindings or the isolated route are absent", () => {
    expect(() => prepareProductionConfiguration({})).toThrow(
      "TRUSTED_PRODUCTION_BINDINGS_MISSING",
    );

    const noRoute = sourceConfig();
    noRoute.env.production.routes = [];
    expect(() => prepareProductionConfiguration(noRoute)).toThrow(
      "TRUSTED_PRODUCTION_ROUTE_MISSING",
    );

    const stagingQueue = sourceConfig();
    stagingQueue.env.production.queues.consumers[0].queue =
      "calenderzw-source-processing-staging";
    expect(() => prepareProductionConfiguration(stagingQueue)).toThrow(
      "TRUSTED_PRODUCTION_ISOLATION_FAILED",
    );
  });

  it("requires an approved immutable candidate and a separate protected deploy job", () => {
    const workflow = readFileSync(
      ".github/workflows/cloudflare-production-gate.yml",
      "utf8",
    );
    expect(workflow).toContain("candidate_sha:");
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("authorize-staging-candidate.mjs");
    expect(workflow).toContain("verify-production-environment.mjs");
    expect(workflow).toContain("environment: cloudflare-production");
    expect(workflow).toContain("prepare-production-deployment.mjs");
    expect(workflow).toContain("--env production");
    expect(workflow).toContain("ENABLE_GOOGLE_DELIVERY:false");
    expect(workflow).toContain("verify-production-origin.mjs");
    expect(workflow.indexOf("record-production-rollback.mjs")).toBeGreaterThan(
      0,
    );
    expect(workflow.indexOf("record-production-rollback.mjs")).toBeLessThan(
      workflow.indexOf("npx wrangler@4.147.0 deploy --config"),
    );
    expect(workflow).not.toContain(
      "rerun this workflow with the previously approved PR head",
    );
    expect(workflow).not.toContain("Production deploy intentionally disabled");
  });

  it("rejects a production environment without required reviewers or with admin bypass", () => {
    const protectedEnvironment = {
      name: "cloudflare-production",
      can_admins_bypass: false,
      protection_rules: [
        {
          type: "required_reviewers",
          prevent_self_review: true,
          reviewers: [{ id: 1 }],
        },
      ],
    };
    expect(assertProductionEnvironment(protectedEnvironment)).toBe(true);
    expect(() =>
      assertProductionEnvironment({
        ...protectedEnvironment,
        protection_rules: [
          {
            type: "required_reviewers",
            prevent_self_review: false,
            reviewers: [{ id: 1 }],
          },
        ],
      }),
    ).toThrow("PRODUCTION_ENVIRONMENT_APPROVAL_REQUIRED");
    expect(() =>
      assertProductionEnvironment({
        ...protectedEnvironment,
        can_admins_bypass: true,
      }),
    ).toThrow("PRODUCTION_ENVIRONMENT_APPROVAL_REQUIRED");
    expect(() =>
      assertProductionEnvironment({
        ...protectedEnvironment,
        protection_rules: [],
      }),
    ).toThrow("PRODUCTION_ENVIRONMENT_APPROVAL_REQUIRED");
  });
});
