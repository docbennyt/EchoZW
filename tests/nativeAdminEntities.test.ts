// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  createInstitution: vi.fn(),
  updateInstitution: vi.fn(),
  createProgramme: vi.fn(),
  updateProgramme: vi.fn(),
  createClassGroup: vi.fn(),
  updateClassGroup: vi.fn(),
  createAcademicPeriod: vi.fn(),
  updateAcademicPeriod: vi.fn(),
}));
vi.mock("../server/supabase/auth.ts", async (original) => ({
  ...(await original<typeof import("../server/supabase/auth.ts")>()),
  requireOperationalAdmin: mocks.guard,
}));
vi.mock("../server/pilotRepository.ts", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository.ts")>()),
  ...Object.fromEntries(
    Object.entries(mocks).filter(([key]) => key !== "guard"),
  ),
}));
import worker from "../worker/index.mjs";
import { AdminAuthError } from "../server/supabase/auth";
import { PilotApiError } from "../server/pilotRepository";
import { handleNativeAdminEntities } from "../worker/adminEntities.mjs";

const id = "00000000-0000-4000-8000-000000000001";
const env = { SUPABASE_URL: "https://fixture.invalid", SOURCE_SHA: "test" };
const cases = [
  {
    path: "institutions",
    property: "institution",
    create: "createInstitution",
    update: "updateInstitution",
    body: { name: "Recovery QA" },
    patch: { name: "Updated QA" },
  },
  {
    path: "programmes",
    property: "programme",
    create: "createProgramme",
    update: "updateProgramme",
    body: { institutionId: id, name: "Recovery QA" },
    patch: { name: "Updated QA" },
  },
  {
    path: "class-groups",
    property: "classGroup",
    create: "createClassGroup",
    update: "updateClassGroup",
    body: { programmeId: id, label: "QA" },
    patch: { label: "Updated QA" },
  },
  {
    path: "academic-periods",
    property: "academicPeriod",
    create: "createAcademicPeriod",
    update: "updateAcademicPeriod",
    body: {
      institutionId: id,
      name: "Recovery QA",
      startsOn: "2026-10-24",
      endsOn: "2026-10-25",
    },
    patch: { name: "Updated QA" },
  },
] as const;
const services = () =>
  Object.entries(mocks)
    .filter(([name]) => name !== "guard")
    .map(([, mock]) => mock);
function request(
  path: string,
  method = "POST",
  body: unknown = {},
  headers: Record<string, string> = {},
) {
  return worker.fetch(
    new Request(`https://staging.example/api/admin/${path}`, {
      method,
      headers: {
        authorization: "Bearer fixture",
        "content-type": "application/json",
        origin: "https://staging.example",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil: () => {} },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.guard.mockResolvedValue({ user: { id: "actor" } });
  for (const mock of services()) mock.mockResolvedValue({ id });
});
describe("native canonical Admin mutations", () => {
  it.each(cases)(
    "creates $path with existing validation and Worker bindings",
    async (c) => {
      const response = await request(c.path, "POST", {
        ...c.body,
        untrustedRole: "superadmin",
      });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ [c.property]: { id } });
      expect(mocks[c.create]).toHaveBeenCalledWith(c.body, env);
      expect(mocks.guard).toHaveBeenCalledOnce();
      expect(mocks.guard.mock.calls[0][0].headers.authorization).toBe(
        "Bearer fixture",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );
  it.each(cases)("updates $path without bypassing service rules", async (c) => {
    const response = await request(`${c.path}/${id}`, "PATCH", {
      ...c.patch,
      untrustedRole: "superadmin",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ [c.property]: { id } });
    expect(mocks[c.update]).toHaveBeenCalledWith(id, c.patch, env);
  });
  it.each(cases)(
    "rejects invalid $path before repository writes",
    async (c) => {
      expect((await request(c.path, "POST", {})).status).toBe(422);
      for (const mock of services()) expect(mock).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403] as const)(
    "preserves operational Admin denial %s",
    async (status) => {
      mocks.guard.mockRejectedValue(
        new AdminAuthError("FORBIDDEN", "Access denied.", status),
      );
      expect((await request("institutions")).status).toBe(status);
      for (const mock of services()) expect(mock).not.toHaveBeenCalled();
    },
  );
  it("rejects cross-origin writes before auth or services", async () => {
    expect(
      (
        await request(
          "institutions",
          "POST",
          { name: "QA" },
          { origin: "https://other.example" },
        )
      ).status,
    ).toBe(403);
    expect(mocks.guard).not.toHaveBeenCalled();
    for (const mock of services()) expect(mock).not.toHaveBeenCalled();
  });
  it("rejects cross-site requests without an Origin header", async () => {
    const response = await request(
      "institutions",
      "POST",
      { name: "QA" },
      { "sec-fetch-site": "cross-site" },
    );
    expect(response.status).toBe(403);
    for (const mock of services()) expect(mock).not.toHaveBeenCalled();
  });
  it("preserves service conflicts", async () => {
    mocks.createInstitution.mockRejectedValue(
      new PilotApiError("CONFLICT", "Slug exists.", 409, { field: "slug" }),
    );
    const response = await request("institutions", "POST", { name: "QA" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "CONFLICT", details: { field: "slug" } },
    });
  });
  it("redacts private database failure details", async () => {
    mocks.createInstitution.mockRejectedValue(
      new PilotApiError(
        "DATABASE_UNAVAILABLE",
        "private database failure",
        503,
        { credential: "private-token" },
      ),
    );
    const response = await request("institutions", "POST", { name: "QA" });
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain("private");
    expect(JSON.parse(text)).toMatchObject({
      error: { code: "DATABASE_UNAVAILABLE" },
    });
  });
  it("requires JSON and bounds the upload before invoking services", async () => {
    expect(
      (
        await request(
          "institutions",
          "POST",
          { name: "QA" },
          { "content-type": "text/plain" },
        )
      ).status,
    ).toBe(415);
    expect(
      (await request("institutions", "POST", { name: "x".repeat(17000) }))
        .status,
    ).toBe(413);
    for (const mock of services()) expect(mock).not.toHaveBeenCalled();
  });
  it.each([new Uint8Array([0xc3]), new TextEncoder().encode("{")])(
    "rejects invalid UTF8/JSON before invoking services",
    async (body) => {
      const response = await handleNativeAdminEntities(
        new Request("https://staging.example/api/admin/institutions", {
          method: "POST",
          headers: {
            authorization: "Bearer fixture",
            "content-type": "application/json",
          },
          body,
        }),
        env,
      );
      expect(response?.status).toBe(422);
      for (const mock of services()) expect(mock).not.toHaveBeenCalled();
    },
  );
  it.each(["GET", "DELETE", "POST"])(
    "rejects %s on an entity detail",
    async (method) => {
      const response = await handleNativeAdminEntities(
        new Request(`https://staging.example/api/admin/institutions/${id}`, {
          method,
        }),
        env,
      );
      expect(response?.status).toBe(405);
      expect(response?.headers.get("allow")).toBe("PATCH");
      expect(mocks.guard).not.toHaveBeenCalled();
    },
  );
  it.each([
    "/api/admin/timetables",
    "/api/admin/staff",
    "/api/admin/institutions/bad-id",
    "/api/admin/institutions",
  ])(
    "leaves unrelated or collection GET reads with their owner: %s",
    async (path) => {
      expect(
        await handleNativeAdminEntities(
          new Request(`https://staging.example${path}`),
          env,
        ),
      ).toBeNull();
      expect(mocks.guard).not.toHaveBeenCalled();
    },
  );
});
