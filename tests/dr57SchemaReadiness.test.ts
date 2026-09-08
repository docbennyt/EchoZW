import { describe, expect, it, vi } from "vitest";
import { checkSchemaCompatibility } from "../server/schemaCompatibility";

const env = {
  SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SECRET_KEY: "server-secret",
  PUBLIC_APP_URL: "https://calender.aido.co.zw",
} as NodeJS.ProcessEnv;

describe("DR-57 Class Rep mutation schema readiness", () => {
  it("probes the DR-53 idempotency, fingerprint, replace, and dedupe primitives", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );

    const result = await checkSchemaCompatibility(env, fetchImpl);

    expect(result.status).toBe("ok");
    const calls = fetchImpl.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: init?.method,
    }));
    const correctionTable = calls.find((call) =>
      call.url.includes("/rest/v1/timetable_correction_directives?"),
    );
    expect(correctionTable?.url).toContain("mutation_key");
    expect(correctionTable?.url).toContain("semantic_fingerprint");
    expect(correctionTable?.url).toContain("revision");

    for (const rpc of [
      "timetable_correction_semantic_fingerprint",
      "timetable_exception_semantic_fingerprint",
      "replace_timetable_correction_update",
      "replace_timetable_exception_update",
      "dedupe_timetable_correction_group",
      "dedupe_timetable_exception_group",
    ]) {
      expect(
        calls.some(
          (call) => call.url.includes(`/rest/v1/rpc/${rpc}`) && call.method === "OPTIONS",
        ),
      ).toBe(true);
    }
  });

  it("fails readiness instead of silently shipping when a correction primitive is missing", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes(
        "/rest/v1/rpc/timetable_correction_semantic_fingerprint",
      )
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 204 }),
    );

    const result = await checkSchemaCompatibility(env, fetchImpl);

    expect(result.status).toBe("incompatible");
    expect(result.failures).toContainEqual({
      object: "timetable_correction_semantic_fingerprint RPC",
      code: "MISSING_OR_INCOMPATIBLE",
    });
  });
});
