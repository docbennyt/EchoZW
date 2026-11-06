// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { cleanupProductionGoogleOnboarding } from "../scripts/cleanup-production-google-onboarding.mjs";
const sha = "a".repeat(40);
const env = {
  GITHUB_REF: "refs/heads/Calender",
  SOURCE_SHA: sha,
  CLOUDFLARE_ACCOUNT_ID: "b".repeat(32),
  CLOUDFLARE_API_TOKEN: "fixture-only",
};
const base = [
  { name: "SOURCE_SHA", text: sha },
  { name: "APP_ENV", text: "cloudflare-production" },
  { name: "ENABLE_GOOGLE_DELIVERY", text: "false" },
];
const ok = (result: unknown) => Response.json({ success: true, result });
describe("protected onboarding binding cleanup", () => {
  it("verifies the active version even when settings already omit the binding", async () => {
    let versions = 0;
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).not.toBe("DELETE");
      const path = new URL(url).pathname;
      if (path.endsWith("/settings")) return ok({ bindings: base });
      if (path.endsWith("/deployments"))
        return ok({
          deployments: [
            {
              versions: [
                {
                  version_id: versions === 0 ? "old-version" : "new-version",
                  percentage: 100,
                },
              ],
            },
          ],
        });
      if (path.includes("/versions/")) {
        versions++;
        return ok({
          resources: {
            bindings:
              versions === 1
                ? [...base, { name: "GOOGLE_PRODUCTION_ONBOARDING" }]
                : base,
          },
        });
      }
      if (path === "/__release")
        return Response.json({
          sourceSha: sha,
          workerVersion: "new-version",
          stage: "cloudflare-production",
        });
      throw Error("Unexpected cleanup request");
    });
    expect(await cleanupProductionGoogleOnboarding(env, request)).toEqual({
      removed: true,
      alreadyAbsent: true,
      workerVersion: "new-version",
    });
    expect(versions).toBe(2);
  });
  it("removes only the temporary binding and verifies the active version", async () => {
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/settings"))
        return ok({
          bindings: [
            ...base,
            { name: "GOOGLE_PRODUCTION_ONBOARDING", type: "secret_text" },
          ],
        });
      if (init?.method === "DELETE") {
        expect(path).toMatch(/\/secrets\/GOOGLE_PRODUCTION_ONBOARDING$/);
        return ok(null);
      }
      if (path.endsWith("/deployments"))
        return ok({
          deployments: [
            { versions: [{ version_id: "next-version", percentage: 100 }] },
          ],
        });
      if (path.endsWith("/versions/next-version"))
        return ok({ resources: { bindings: base } });
      if (path === "/__release")
        return Response.json({
          sourceSha: sha,
          workerVersion: "next-version",
          stage: "cloudflare-production",
        });
      throw Error("Unexpected cleanup request");
    });
    expect(await cleanupProductionGoogleOnboarding(env, request)).toEqual({
      removed: true,
      workerVersion: "next-version",
    });
    expect(
      request.mock.calls.filter(([, init]) => init?.method === "DELETE"),
    ).toHaveLength(1);
  });
  it("rejects a changed production source before deleting configuration", async () => {
    const request = vi.fn().mockResolvedValue(
      ok({
        bindings: base.map((x) =>
          x.name === "SOURCE_SHA" ? { ...x, text: "c".repeat(40) } : x,
        ),
      }),
    );
    await expect(
      cleanupProductionGoogleOnboarding(env, request),
    ).rejects.toThrow("GOOGLE_ONBOARDING_CLEANUP_RELEASE_MISMATCH");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
