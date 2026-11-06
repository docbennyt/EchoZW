// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  failure: false,
  writes: 0,
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: () => ({
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let patch: Record<string, unknown> | undefined;
      const run = () => {
        if (state.failure) return { error: { code: "42703" }, data: null };
        const rows = state.rows.filter((row) =>
          filters.every(([key, value]) => row[key] === value),
        );
        if (patch) {
          rows.forEach((row) => Object.assign(row, patch));
          state.writes += rows.length;
        }
        return {
          error: null,
          data: rows.map(({ id, provider, exam_reminder_offsets_minutes }) => ({
            id,
            provider,
            exam_reminder_offsets_minutes,
          })),
        };
      };
      const chain = {
        select: () => chain,
        update: (value: Record<string, unknown>) => {
          patch = value;
          return chain;
        },
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        is: (key: string, value: unknown) => {
          filters.push([key, value]);
          return chain;
        },
        maybeSingle: async () => {
          const r = run();
          return { ...r, data: r.data?.[0] ?? null };
        },
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve(run()).then(resolve),
      };
      return chain;
    },
  }),
}));
import {
  listOwnedExamReminderPreferences,
  updateOwnedExamReminderPreferences,
} from "../server/examReminderPreferences.js";
import { handleExamReminderPreferences } from "../worker/subscriptionPreferences.mjs";
const owner = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const timetable = "00000000-0000-4000-8000-000000000003";
const subscription = "00000000-0000-4000-8000-000000000004";
const env = { PUBLIC_APP_URL: "https://calender.aido.co.zw" };
const row = () => ({
  id: subscription,
  timetable_id: timetable,
  anonymous_session_id: owner,
  status: "active",
  provider: "google_api",
  revoked_at: null,
  exam_reminder_offsets_minutes: [],
  reminder_offsets_minutes: [1440, 30],
  external_calendar_id: "original-calendar",
  google_connection_generation: 7,
});
const input = {
  subscriptionId: subscription,
  offsets: [60, 30, 60],
  consent: true,
};
const request = (
  body: unknown,
  origin = env.PUBLIC_APP_URL,
  cookieOwner = owner,
) =>
  new Request(
    "https://backend.calender.aido.co.zw/api/calendar/subscriptions/exam-reminders",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        origin,
        "sec-fetch-site": "same-origin",
        cookie: "calenderzw_anon_session=" + cookieOwner,
      },
      body: JSON.stringify(body),
    },
  );
describe("owner-consented examination reminder preferences", () => {
  beforeEach(() => {
    state.rows = [row()];
    state.writes = 0;
    state.failure = false;
  });
  it("edits, deduplicates and removes only examination reminders", async () => {
    const before = structuredClone(state.rows[0]);
    expect(await updateOwnedExamReminderPreferences(input, owner, env)).toEqual(
      { offsets: [60, 30] },
    );
    expect(state.rows[0]).toEqual({
      ...before,
      exam_reminder_offsets_minutes: [60, 30],
    });
    await updateOwnedExamReminderPreferences(
      { ...input, offsets: [], consent: false },
      owner,
      env,
    );
    expect(state.rows[0]).toEqual(before);
  });
  it.each([null, foreign])(
    "rejects a missing or foreign owner without writing",
    async (identity) => {
      await expect(
        updateOwnedExamReminderPreferences(input, identity, env),
      ).rejects.toMatchObject({ status: identity ? 404 : 403 });
      expect(state.writes).toBe(0);
    },
  );
  it.each([
    { consent: false },
    { offsets: [0] },
    { offsets: [-30] },
    { offsets: [1.5] },
    { offsets: [40321] },
    { offsets: [1, 2, 3, 4, 5, 6] },
    { extra: true },
  ])("rejects unsafe or unconsented input %j", async (change) => {
    await expect(
      updateOwnedExamReminderPreferences({ ...input, ...change }, owner, env),
    ).rejects.toMatchObject({ status: 422 });
    expect(state.writes).toBe(0);
  });
  it("rejects revoked and disconnected subscriptions at the write boundary", async () => {
    state.rows[0].revoked_at = "2026-11-06T00:00:00Z";
    await expect(
      updateOwnedExamReminderPreferences(input, owner, env),
    ).rejects.toMatchObject({ status: 404 });
    state.rows[0].revoked_at = null;
    state.rows[0].status = "disconnected";
    await expect(
      updateOwnedExamReminderPreferences(input, owner, env),
    ).rejects.toMatchObject({ status: 404 });
    expect(state.writes).toBe(0);
  });
  it("lists only owned active subscriptions for the selected class with no private fields", async () => {
    state.rows.push(
      { ...row(), anonymous_session_id: foreign },
      { ...row(), revoked_at: "revoked" },
      { ...row(), timetable_id: foreign },
    );
    expect(
      await listOwnedExamReminderPreferences(timetable, owner, env),
    ).toEqual({
      subscriptions: [
        { id: subscription, provider: "google_api", offsets: [] },
      ],
    });
  });
  it("reports a missing migration as unavailable without recording success", async () => {
    state.failure = true;
    await expect(
      updateOwnedExamReminderPreferences(input, owner, env),
    ).rejects.toMatchObject({ status: 503 });
    expect(state.writes).toBe(0);
  });
  it("accepts the trusted public rewrite and denies foreign origins", async () => {
    expect(
      (await handleExamReminderPreferences(request(input), env)).status,
    ).toBe(200);
    expect(
      (
        await handleExamReminderPreferences(
          request(input, "https://foreign.invalid"),
          env,
        )
      ).status,
    ).toBe(403);
    expect(state.writes).toBe(1);
  });
  it("does not authorize with caller supplied owner headers or leak fields", async () => {
    const response = await handleExamReminderPreferences(
      new Request(
        "https://backend.calender.aido.co.zw/api/calendar/subscriptions/exam-reminders?timetableId=" +
          timetable,
        { headers: { "x-calenderzw-anonymous-id": owner } },
      ),
      env,
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.writes).toBe(0);
  });
});
