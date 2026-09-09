import { describe, expect, it } from "vitest";
import { getWebPushConfig, publicWebPushConfig } from "../server/pushConfig";

const publicKey = "B".repeat(87);
const privateKey = "c".repeat(43);

describe("DR-46 web push config", () => {
  it("is safely disabled when no VAPID material is configured", () => {
    expect(getWebPushConfig({})).toEqual({ enabled: false });
    expect(publicWebPushConfig({})).toEqual({ enabled: false });
  });

  it("fails closed on partial configuration", () => {
    expect(() =>
      getWebPushConfig({ WEB_PUSH_VAPID_PUBLIC_KEY: publicKey }),
    ).toThrow("WEB_PUSH_VAPID_CONFIG_INCOMPLETE");
  });

  it("exposes only the public VAPID key to the browser", () => {
    const env = {
      WEB_PUSH_VAPID_PUBLIC_KEY: publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: privateKey,
      WEB_PUSH_VAPID_SUBJECT: "mailto:support@calenderzw.com",
    };
    expect(publicWebPushConfig(env)).toEqual({
      enabled: true,
      publicKey,
    });
    expect(JSON.stringify(publicWebPushConfig(env))).not.toContain(privateKey);
  });
});
