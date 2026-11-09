// @vitest-environment node
import { describe, expect, it } from "vitest";
import { googleProductionRecoveryScope } from "../server/googleProductionRecoveryPolicy";
const sha = "a".repeat(40);
const plan = () => ({
  deliveryRevision: 8,
  deliveryGeneration: 2,
  candidateSha: sha,
  ownerId: "11111111-1111-4111-8111-111111111111",
  timetableId: "22222222-2222-4222-8222-222222222222",
  subscriptionId: "33333333-3333-4333-8333-333333333333",
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  revision: 12,
  connectionGeneration: 2,
  maxCreates: 8,
  maxUpdates: 20,
  maxDeletes: 0,
  manifestHash: "b".repeat(64),
  createKeys: [],
  updateKeys: [],
});
const env = (p = plan()) => ({
  APP_ENV: "cloudflare-production",
  SOURCE_SHA: sha,
  ENABLE_GOOGLE_DELIVERY: "false",
  GOOGLE_PRODUCTION_RECOVERY: JSON.stringify(p),
});
describe("production recovery scope", () => {
  it("accepts only operator-controlled release-pinned scope", () => {
    expect(googleProductionRecoveryScope(env())).toMatchObject({
      revision: 12,
      maxCreates: 8,
      maxUpdates: 20,
    });
  });
  it.each([
    { maxDeletes: 1 },
    { maxCreates: 17 },
    { maxUpdates: 65 },
    { revision: 0 },
    { connectionGeneration: -1 },
    { ownerId: "*" },
    { candidateSha: "c".repeat(40) },
    { manifestHash: "" },
    { expiresAt: new Date(0).toISOString() },
    { expiresAt: new Date(Date.now() + 90000000).toISOString() },
  ])("rejects invalid scope %#", (override) => {
    expect(
      googleProductionRecoveryScope(env({ ...plan(), ...override })),
    ).toBeNull();
  });
  it("does not broaden staging or global gates", () => {
    expect(
      googleProductionRecoveryScope({
        ...env(),
        APP_ENV: "cloudflare-staging",
      }),
    ).toBeNull();
    expect(
      googleProductionRecoveryScope({
        ...env(),
        ENABLE_GOOGLE_DELIVERY: "true",
      }),
    ).toBeNull();
    expect(
      googleProductionRecoveryScope({
        ...env(),
        GOOGLE_PRODUCTION_RECOVERY: "",
      }),
    ).toBeNull();
  });
});
