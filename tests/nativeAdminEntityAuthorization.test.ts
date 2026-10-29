// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  role: "admin",
  active: true,
  founder: false,
  valid: true,
  write: vi.fn(),
  error: false,
}));
vi.mock("../server/supabase/userClient.ts", () => ({
  createSupabaseUserClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.valid ? { id: "operator" } : null },
        error: null,
      }),
    },
  }),
}));
vi.mock("../server/supabase/adminClient.ts", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) =>
      table === "class_rep_assignments"
        ? {
            select: () => ({
              eq: () => ({ eq: async () => ({ data: [], error: null }) }),
            }),
          }
        : {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: "staff",
                    user_id: "operator",
                    role: state.role,
                    active: state.active,
                    is_founder: state.founder,
                  },
                  error: state.error ? {} : null,
                }),
              }),
            }),
          },
  }),
}));
vi.mock("../server/pilotRepository.ts", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository.ts")>()),
  createInstitution: state.write,
}));
import { handleNativeAdminEntities } from "../worker/adminEntities.mjs";
function request(authorization = "Bearer test") {
  return handleNativeAdminEntities(
    new Request("https://staging.example/api/admin/institutions", {
      method: "POST",
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify({
        name: "Recovery QA",
        role: "superadmin",
        isFounder: true,
      }),
    }),
    { SUPABASE_URL: "https://fixture.invalid" },
  );
}
beforeEach(() => {
  state.role = "admin";
  state.active = true;
  state.founder = false;
  state.valid = true;
  state.error = false;
  state.write.mockReset().mockResolvedValue({ id: "institution" });
});
describe("canonical mutation real operational authorization", () => {
  it.each(["admin", "founder"])("permits active %s", async (role) => {
    if (role === "founder") {
      state.role = "superadmin";
      state.founder = true;
    }
    expect((await request())?.status).toBe(201);
    expect(state.write).toHaveBeenCalledOnce();
  });
  it.each([
    "class_rep",
    "unmarked_superadmin",
    "inactive",
    "invalid_session",
    "anonymous",
    "database_error",
  ])("denies %s without writes", async (scenario) => {
    if (scenario === "class_rep") state.role = "class_rep";
    if (scenario === "unmarked_superadmin") state.role = "superadmin";
    if (scenario === "inactive") state.active = false;
    if (scenario === "invalid_session") state.valid = false;
    if (scenario === "database_error") state.error = true;
    const response = await request(
      scenario === "anonymous" ? "" : "Bearer test",
    );
    expect(response?.status).toBe(
      scenario === "database_error"
        ? 503
        : ["anonymous", "invalid_session"].includes(scenario)
          ? 401
          : 403,
    );
    expect(state.write).not.toHaveBeenCalled();
    expect(response?.headers.get("cache-control")).toBe("no-store");
  });
});
