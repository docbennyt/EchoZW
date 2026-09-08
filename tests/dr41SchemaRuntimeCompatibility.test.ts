import { describe, expect, it, vi } from "vitest";
import { isMissingAcademicPauseSchemaError } from "../server/academicPauseRepository";
import { checkSchemaCompatibility } from "../server/schemaCompatibility";

const env = {
  SUPABASE_URL: "https://jkafqgdymfiiklmozvhi.supabase.co",
  SUPABASE_ANON_KEY: "public-anon-key",
  SUPABASE_SECRET_KEY: "server-secret",
} as NodeJS.ProcessEnv;

describe("DR-41 schema/runtime compatibility", () => {
  it("recognizes PostgREST schema-cache misses so public reads degrade safely", () => {
    expect(
      isMissingAcademicPauseSchemaError({
        code: "PGRST205",
        message:
          "Could not find the table 'public.academic_schedule_pauses' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingAcademicPauseSchemaError({
        code: "42P01",
        message: 'relation "academic_schedule_pauses" does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingAcademicPauseSchemaError({
        code: "42501",
        message: "permission denied",
      }),
    ).toBe(false);
  });

  it("makes the pause table a startup readiness dependency", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 204 }),
    );
    const result = await checkSchemaCompatibility(env, fetchImpl);
    expect(result.status).toBe("ok");
    expect(
      fetchImpl.mock.calls.some(
        ([url, init]) =>
          String(url).includes(
            "/rest/v1/academic_schedule_pauses?select=id&limit=0",
          ) && init?.method === "HEAD",
      ),
    ).toBe(true);
  });

  it("reports deployment drift instead of a false green readiness", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).includes("/rest/v1/academic_schedule_pauses?")
        ? new Response(null, { status: 404 })
        : new Response(null, { status: 204 }),
    );
    const result = await checkSchemaCompatibility(env, fetchImpl);
    expect(result.status).toBe("incompatible");
    expect(result.failures).toContainEqual({
      object: "academic_schedule_pauses",
      code: "MISSING_OR_INCOMPATIBLE",
    });
  });
});
