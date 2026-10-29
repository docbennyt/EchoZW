import { beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptionRequestSchema } from "../src/domain/subscriptions";

const repo = vi.hoisted(() => ({
  createCalendarSubscriptionRecord: vi.fn(),
  updateGoogleSubscription: vi.fn(),
}));
vi.mock("../server/pilotRepository", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository")>()),
  createCalendarSubscriptionRecord: repo.createCalendarSubscriptionRecord,
}));
vi.mock("../server/googleCalendarRepository", async (original) => ({
  ...(await original<typeof import("../server/googleCalendarRepository")>()),
  updateGoogleSubscription: repo.updateGoogleSubscription,
}));
import { createNativeFeedSubscription } from "../server/calendarSubscriptionCore";

const env = {
  ENABLE_GOOGLE_DELIVERY: "true",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  GOOGLE_REDIRECT_URI: "https://calendar.example/api/calendar/google/callback",
  TOKEN_ENCRYPTION_KEY: "original-test-key",
};
const context = {
  publicOrigin: "https://calendar.example",
  anonymousSessionId: "owner",
  env,
};
const input = subscriptionRequestSchema.parse({
  timetableId: "11111111-1111-4111-8111-111111111111",
  provider: "google_api",
  reminderPreset: "on_time",
});

describe("native pending Google subscription creation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    repo.createCalendarSubscriptionRecord.mockResolvedValue({
      id: "sub-1",
      calendar_name: "Class calendar",
    });
  });
  it.each([
    {},
    { ...env, ENABLE_GOOGLE_DELIVERY: "false" },
    { ...env, ENABLE_GOOGLE_DELIVERY: undefined },
    { ...env, TOKEN_ENCRYPTION_KEY: "" },
    { ...env, GOOGLE_CLIENT_SECRET: "" },
  ])(
    "fails before persistence when original configuration is unavailable",
    async (bindings) => {
      await expect(
        createNativeFeedSubscription(input, { ...context, env: bindings }),
      ).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED", status: 503 });
      expect(repo.createCalendarSubscriptionRecord).not.toHaveBeenCalled();
    },
  );
  it("creates pending Google setup with the original owner, reminders and no feed token", async () => {
    const result = await createNativeFeedSubscription(input, context);
    expect(repo.createCalendarSubscriptionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "google_api",
        anonymousSessionId: "owner",
        tokenHash: undefined,
        reminderOffsetsMinutes: [30],
      }),
      env,
    );
    expect(repo.updateGoogleSubscription).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      status: "pending",
      lastErrorCode: null,
      env,
    });
    expect(result.googleConnectUrl).toBe(
      "https://calendar.example/api/calendar/google/connect?subscriptionId=sub-1",
    );
    expect(result.feedUrl).toBeUndefined();
    expect(result.downloadUrl).toBeUndefined();
  });
  it("allows only the designated owner/timetable to prepare a pending canary while global delivery stays off", async () => {
    const owner = "33333333-3333-4333-8333-333333333333";
    const bindings = {
      ...env,
      ENABLE_GOOGLE_DELIVERY: "false",
      APP_ENV: "cloudflare-staging",
      GOOGLE_CANARY_OWNER_ID: owner,
      GOOGLE_CANARY_TIMETABLE_ID: input.timetableId,
      GOOGLE_CANARY_EXPIRES_AT: new Date(Date.now() + 3600000).toISOString(),
    };
    await createNativeFeedSubscription(input, {
      ...context,
      anonymousSessionId: owner,
      env: bindings,
    });
    expect(repo.createCalendarSubscriptionRecord).toHaveBeenCalledOnce();
    repo.createCalendarSubscriptionRecord.mockClear();
    await expect(
      createNativeFeedSubscription(input, { ...context, env: bindings }),
    ).rejects.toMatchObject({ code: "GOOGLE_NOT_CONFIGURED" });
    expect(repo.createCalendarSubscriptionRecord).not.toHaveBeenCalled();
  });
});
