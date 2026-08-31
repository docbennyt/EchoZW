import { describe, expect, it, vi } from "vitest";

const adminClientMocks = vi.hoisted(() => ({
  createSupabaseAdminClient: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: adminClientMocks.createSupabaseAdminClient,
}));

import { setStaffActive } from "../server/staffRepository";

function queryBuilder(input: {
  single?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
}) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    single: vi.fn(async () => ({ data: input.single ?? null, error: null })),
    maybeSingle: vi.fn(async () => ({
      data: input.single ?? null,
      error: null,
    })),
    then: (
      resolve: (value: {
        data: Record<string, unknown>[] | null;
        error: null;
      }) => unknown,
    ) => resolve({ data: input.list ?? [], error: null }),
  };
  return builder;
}

describe("staff repository safety", () => {
  it("does not disable the last active superadmin", async () => {
    const staffLookup = queryBuilder({
      single: { id: "staff-super", role: "superadmin", active: true },
    });
    const superadminCount = queryBuilder({
      list: [{ id: "staff-super" }],
    });
    const updateBuilder = queryBuilder({ single: { id: "staff-super" } });
    const from = vi
      .fn()
      .mockReturnValueOnce(staffLookup)
      .mockReturnValueOnce(superadminCount)
      .mockReturnValue(updateBuilder);
    adminClientMocks.createSupabaseAdminClient.mockReturnValue({
      from,
    });

    await expect(
      setStaffActive({
        actorId: "actor-1",
        staffUserId: "staff-super",
        active: false,
      }),
    ).rejects.toMatchObject({
      code: "LAST_SUPERADMIN",
      status: 409,
    });

    expect(updateBuilder.update).not.toHaveBeenCalled();
  });
});
