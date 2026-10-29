import { describe, expect, it, vi } from "vitest";
import {
  sameReviewedResources,
  verifyRecoveryWorker,
} from "../scripts/verify-recovery-worker.mjs";

const resources = () => ({
  script: { etag: "reviewed-script-etag" },
  script_runtime: {
    compatibility_date: "2026-10-20",
    compatibility_flags: ["nodejs_compat"],
  },
  bindings: [
    { name: "SOURCE_SHA", type: "plain_text", text: "a".repeat(40) },
    { name: "ASSETS", type: "assets", asset_manifest: "reviewed-assets" },
  ],
});
describe("recovery version provenance", () => {
  it.each([true, false])(
    "permits only recovery authority to be added or removed: %s",
    (added) => {
      const withSecret = {
        ...resources(),
        bindings: [
          ...resources().bindings,
          { name: "GOOGLE_RECOVERY_CANARY", type: "secret_text" },
          {
            name: "GOOGLE_CREDENTIAL_RECOVERY_SCOPE",
            type: "secret_text",
          },
          { name: "LEGACY_TOKEN_ENCRYPTION_KEY", type: "secret_text" },
        ],
      };
      expect(
        sameReviewedResources(
          added ? resources() : withSecret,
          added ? withSecret : resources(),
        ),
      ).toBe(true);
    },
  );
  it("ignores key order and binding order", () => {
    expect(
      sameReviewedResources(resources(), {
        ...resources(),
        bindings: resources().bindings.reverse(),
        script_runtime: {
          compatibility_flags: ["nodejs_compat"],
          compatibility_date: "2026-10-20",
        },
      }),
    ).toBe(true);
  });
  it.each([
    { ...resources(), script: { etag: "unreviewed" } },
    { ...resources(), script_runtime: { compatibility_date: "2026-10-21" } },
    {
      ...resources(),
      bindings: resources().bindings.map((b) =>
        b.name === "ASSETS" ? { ...b, asset_manifest: "unreviewed-assets" } : b,
      ),
    },
    {
      ...resources(),
      bindings: [
        ...resources().bindings,
        { name: "ENABLE_GOOGLE_DELIVERY", type: "plain_text", text: "true" },
      ],
    },
    { ...resources(), script: {} },
  ])("rejects changed or unverifiable reviewed resources %j", (active) => {
    expect(sameReviewedResources(resources(), active)).toBe(false);
  });
  it("rejects two versions without script etags", () => {
    expect(
      sameReviewedResources(
        { ...resources(), script: {} },
        { ...resources(), script: {} },
      ),
    ).toBe(false);
  });
  it("compares active and reviewed version resources through fixed read-only requests", async () => {
    const reviewed = "10000000-0000-4000-8000-000000000001";
    const active = "20000000-0000-4000-8000-000000000001";
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          success: true,
          result: {
            deployments: [
              { versions: [{ version_id: active, percentage: 100 }] },
            ],
          },
        }),
      )
      .mockImplementation(async () =>
        Response.json({ success: true, result: { resources: resources() } }),
      );
    expect(
      await verifyRecoveryWorker(
        {
          CLOUDFLARE_ACCOUNT_ID: "f".repeat(32),
          CLOUDFLARE_API_TOKEN: "private-token",
          REVIEWED_WORKER_VERSION: reviewed,
        },
        request,
      ),
    ).toBe(active);
    expect(
      request.mock.calls.map(([url]) =>
        new URL(url).pathname.split("/").slice(-2).join("/"),
      ),
    ).toEqual([
      "calenderzw-edge-staging/deployments",
      `versions/${reviewed}`,
      `versions/${active}`,
    ]);
    for (const [url, init] of request.mock.calls) {
      expect(new URL(url).origin).toBe("https://api.cloudflare.com");
      expect(init.redirect).toBe("error");
      expect(init.method).toBeUndefined();
      expect(init.body).toBeUndefined();
    }
  });
});
