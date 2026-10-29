// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  subscription: vi.fn(),
  client: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../server/pilotRepository", () => ({
  getCalendarSubscriptionById: mocks.subscription,
}));
vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: mocks.client,
}));
import { recoverGoogleCalendarSubscriptionDelivery } from "../server/googleCalendarDelivery";
const id = "33333333-3333-4333-8333-333333333333";
const owner = "11111111-1111-4111-8111-111111111111";
const timetable = "22222222-2222-4222-8222-222222222222";
const config = () => ({
  APP_ENV: "cloudflare-staging",
  ENABLE_GOOGLE_DELIVERY: "false",
  GOOGLE_CANARY_OWNER_ID: owner,
  GOOGLE_CANARY_TIMETABLE_ID: timetable,
  GOOGLE_CANARY_SUBSCRIPTION_ID: id,
  GOOGLE_CANARY_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
});
const completed = {
  desired_revision: 8,
  successful_revision: 8,
  requested_generation: 2,
  successful_generation: 2,
  available_at: new Date(0).toISOString(),
  reconnect_required_at: null,
};
let rows: Record<string, unknown>;
let errorTable: string | undefined;
const filters: Array<[string, string, unknown]> = [];
describe("single-subscription durable canary recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    filters.length = 0;
    errorTable = undefined;
    mocks.subscription.mockResolvedValue({
      id,
      anonymous_session_id: owner,
      timetable_id: timetable,
      provider: "google_api",
      status: "active",
    });
    rows = {
      google_calendar_credentials: { subscription_id: id },
      google_calendar_delivery_revisions: { revision: 8 },
      google_calendar_delivery_jobs: { ...completed },
    };
    mocks.rpc.mockResolvedValue({ data: true, error: null });
    mocks.client.mockReturnValue({
      rpc: mocks.rpc,
      from: (table: string) => {
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters.push([table, key, value]);
            return query;
          },
          maybeSingle: async () => ({
            data: rows[table],
            error:
              errorTable === table ? { message: "private DB error" } : null,
          }),
        };
        return query;
      },
    });
  });
  it("does not enqueue a completed generation on every Cron invocation", async () => {
    expect(await recoverGoogleCalendarSubscriptionDelivery(id, config())).toBe(
      false,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(filters).toContainEqual([
      "google_calendar_delivery_jobs",
      "subscription_id",
      id,
    ]);
    expect(filters).toContainEqual([
      "google_calendar_delivery_revisions",
      "timetable_id",
      timetable,
    ]);
  });
  it.each([null, { ...completed, desired_revision: 7 }])(
    "creates or advances only the selected subscription's durable intent %#",
    async (job) => {
      rows.google_calendar_delivery_jobs = job;
      expect(
        await recoverGoogleCalendarSubscriptionDelivery(id, config()),
      ).toBe(true);
      expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
        "enqueue_google_calendar_subscription",
        { p_subscription_id: id },
      );
    },
  );
  it("wakes an incomplete due job without incrementing its generation", async () => {
    rows.google_calendar_delivery_jobs = {
      ...completed,
      successful_revision: 7,
    };
    expect(await recoverGoogleCalendarSubscriptionDelivery(id, config())).toBe(
      true,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { reconnect_required_at: new Date().toISOString(), successful_revision: 7 },
    {
      available_at: new Date(Date.now() + 60000).toISOString(),
      successful_revision: 7,
    },
  ])("preserves backoff and reconnect boundaries %#", async (state) => {
    rows.google_calendar_delivery_jobs = { ...completed, ...state };
    expect(await recoverGoogleCalendarSubscriptionDelivery(id, config())).toBe(
      false,
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects foreign ownership before reading credentials or persisting jobs", async () => {
    mocks.subscription.mockResolvedValue({ id, anonymous_session_id: "other" });
    expect(await recoverGoogleCalendarSubscriptionDelivery(id, config())).toBe(
      false,
    );
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("does not start delivery before OAuth and fails closed on database errors", async () => {
    rows.google_calendar_credentials = null;
    expect(await recoverGoogleCalendarSubscriptionDelivery(id, config())).toBe(
      false,
    );
    errorTable = "google_calendar_credentials";
    await expect(
      recoverGoogleCalendarSubscriptionDelivery(id, config()),
    ).rejects.toThrow("GOOGLE_CANARY_RECOVERY_UNAVAILABLE");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
