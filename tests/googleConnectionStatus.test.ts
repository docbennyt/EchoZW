import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({
  from: vi.fn(),
  rows: new Map<string, unknown>(),
  filters: [] as Array<[string, unknown]>,
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: () => db,
}));
import { getOwnedGoogleConnection } from "../server/googleConnectionStatus.js";
const owner = "11111111-1111-4111-8111-111111111111";
const timetable = "22222222-2222-4222-8222-222222222222";
const row = {
  id: "33333333-3333-4333-8333-333333333333",
  provider: "google_api",
  status: "active",
  anonymous_session_id: owner,
  timetable_id: timetable,
  revoked_at: null,
  last_synced_at: "2026-11-03T12:00:00Z",
  external_calendar_id: "private-calendar",
  last_error_code: null,
};
beforeEach(() => {
  db.filters = [];
  db.rows = new Map<string, unknown>([
    ["calendar_subscriptions", row],
    [
      "google_calendar_delivery_jobs",
      {
        desired_revision: 10,
        successful_revision: 9,
        requested_generation: 2,
        successful_generation: 2,
        reconnect_required_at: null,
      },
    ],
  ]);
  db.from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      order: () => query,
      limit: () => query,
      eq: (key: string, value: unknown) => {
        db.filters.push([key, value]);
        return query;
      },
      is: (key: string, value: unknown) => {
        db.filters.push([key, value]);
        return query;
      },
      maybeSingle: async () => ({ data: db.rows.get(table), error: null }),
    };
    return query;
  });
});
describe("owner Google connection status", () => {
  it("requires the original browser owner and never returns private calendar identifiers", async () => {
    expect(await getOwnedGoogleConnection(timetable, null, {})).toBeNull();
    expect(db.from).not.toHaveBeenCalled();
    const result = await getOwnedGoogleConnection(timetable, owner, {});
    expect(db.filters).toContainEqual(["anonymous_session_id", owner]);
    expect(db.filters).toContainEqual(["timetable_id", timetable]);
    expect(db.filters).toContainEqual(["provider", "google_api"]);
    expect(result).toMatchObject({ subscriptionId: row.id, state: "syncing" });
    expect(JSON.stringify(result)).not.toContain("private-calendar");
  });
  it("never treats active or an earlier success as current delivery convergence", async () => {
    expect((await getOwnedGoogleConnection(timetable, owner, {}))?.state).toBe(
      "syncing",
    );
    db.rows.set("google_calendar_delivery_jobs", {
      desired_revision: 10,
      successful_revision: 10,
      requested_generation: 2,
      successful_generation: 1,
    });
    expect((await getOwnedGoogleConnection(timetable, owner, {}))?.state).toBe(
      "syncing",
    );
    db.rows.set("google_calendar_delivery_jobs", {
      desired_revision: 10,
      successful_revision: 10,
      requested_generation: 2,
      successful_generation: 2,
    });
    expect((await getOwnedGoogleConnection(timetable, owner, {}))?.state).toBe(
      "synced",
    );
  });
  it("requires renewed consent only after positive credential failure evidence", async () => {
    db.rows.set("google_calendar_delivery_jobs", {
      reconnect_required_at: "2026-11-06T12:00:00Z",
    });
    expect((await getOwnedGoogleConnection(timetable, owner, {}))?.state).toBe(
      "reconnect_required",
    );
    db.rows.set("google_calendar_delivery_jobs", null);
    db.rows.set("calendar_subscriptions", {
      ...row,
      status: "failed",
      last_error_code: "GOOGLE_REQUEST_FAILED",
    });
    expect((await getOwnedGoogleConnection(timetable, owner, {}))?.state).toBe(
      "failed",
    );
  });
});
