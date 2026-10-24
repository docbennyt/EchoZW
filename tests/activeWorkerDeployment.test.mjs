// @vitest-environment node
/* global Response, console */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ write: vi.fn(), log: "" }));
vi.mock("node:fs", () => ({
  readFileSync: () => state.log,
  appendFileSync: state.write,
}));

const version = "12341525-6d46-4fdb-93aa-95f1cf78ca06";
const active = (id = version, percentage = 100) => ({
  versions: [{ version_id: id, percentage }],
});
let request;
beforeEach(() => {
  vi.resetModules();
  state.write.mockReset();
  state.log = `Current Version ID: ${version}\n`;
  vi.stubEnv("EXPECTED_WORKER_VERSION", "");
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "test-account");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "private-test-token");
  vi.stubEnv("GITHUB_OUTPUT", "test-output");
  request = vi.fn();
  vi.stubGlobal("fetch", request);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const run = () => import("../scripts/verify-active-worker-deployment.mjs");
const reply = (body, status = 200) =>
  request.mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe("active Worker API verification", () => {
  it("accepts the documented direct deployments response", async () => {
    reply({ deployments: [active()] });
    await run();
    expect(state.write).toHaveBeenCalledWith(
      "test-output",
      `version=${version}\n`,
    );
  });
  it("preserves compatibility with the legacy result envelope", async () => {
    reply({ success: true, result: { deployments: [active()] } });
    await run();
    expect(state.write).toHaveBeenCalledTimes(1);
  });
  it("verifies an existing immutable version without a deployment log", async () => {
    vi.stubEnv("EXPECTED_WORKER_VERSION", version);
    state.log = "no deploy performed";
    reply({ deployments: [active()] });
    await run();
    expect(state.write).toHaveBeenCalledWith(
      "test-output",
      `version=${version}\n`,
    );
  });
  it.each([
    { deployments: [] },
    { deployments: [active("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")] },
    { deployments: [active("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), active()] },
    { deployments: [active(version, 50)] },
    {
      deployments: [{ versions: [...active().versions, ...active().versions] }],
    },
    { success: false, deployments: [active()] },
    { errors: [{ code: 10000 }], deployments: [active()] },
    { result: [] },
  ])("fails closed for a non-active or ambiguous version: %j", async (body) => {
    reply(body);
    await expect(run()).rejects.toThrow("ACTIVE_DEPLOYMENT_VERSION_MISMATCH");
    expect(state.write).not.toHaveBeenCalled();
  });
  it.each([401, 403, 429, 500])(
    "classifies API HTTP %s without exposing response bodies",
    async (status) => {
      reply({ error: "private-provider-details" }, status);
      await expect(run()).rejects.toThrow(
        `ACTIVE_DEPLOYMENT_LOOKUP_FAILED_HTTP_${status}`,
      );
      expect(state.write).not.toHaveBeenCalled();
      expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain(
        "private",
      );
    },
  );
  it("rejects invalid explicit version before making an authenticated request", async () => {
    vi.stubEnv("EXPECTED_WORKER_VERSION", "not-a-version");
    await expect(run()).rejects.toThrow("DEPLOYMENT_VERSION_MISSING");
    expect(request).not.toHaveBeenCalled();
  });
});
