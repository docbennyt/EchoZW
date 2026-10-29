// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
const append = vi.hoisted(() => vi.fn());
vi.mock("node:fs", () => ({ appendFileSync: append }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  append.mockClear();
});
describe("production rollback capture", () => {
  it("records an empty successful deployment list as the first release", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, result: { deployments: [] } }),
      ),
    );
    await import("../scripts/record-production-rollback.mjs");
    expect(append.mock.calls[0][1]).toContain("First production release");
  });
  it("rejects malformed deployment metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, result: {} })),
    );
    await expect(
      import("../scripts/record-production-rollback.mjs"),
    ).rejects.toThrow("PRODUCTION_ROLLBACK_VERSION_UNCERTAIN");
    expect(append).not.toHaveBeenCalled();
  });
});
