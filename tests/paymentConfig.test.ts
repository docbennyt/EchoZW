import { describe, expect, it } from "vitest";
import {
  buildPublicPaymentCapability,
  resolvePaymentServerConfig,
} from "../server/paymentConfig";

const key = "12345678901234567890123456789012";

describe("payment configuration", () => {
  it("is disabled by default and exposes no credentials through capability", () => {
    const config = resolvePaymentServerConfig({} as NodeJS.ProcessEnv);
    expect(config.mode).toBe("disabled");
    expect(config.enabled).toBe(false);
    const publicCapability = buildPublicPaymentCapability(config);
    expect(publicCapability.checkoutEnabled).toBe(false);
    expect(JSON.stringify(publicCapability)).not.toContain("INTEGRATION");
    expect(JSON.stringify(publicCapability)).not.toContain(key);
  });

  it("allows an explicitly enabled sandbox but requires an exact AES key", () => {
    const config = resolvePaymentServerConfig({
      PESEPAY_MODE: "sandbox",
      PAYMENTS_ENABLED: "true",
      PESEPAY_INTEGRATION_KEY: "sandbox-integration",
      PESEPAY_ENCRYPTION_KEY: key,
      PUBLIC_APP_URL: "https://calender.aido.co.zw/",
    } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(true);
    expect(config.publicAppUrl).toBe("https://calender.aido.co.zw");
    expect(config.createPaymentUrl).toContain("sandbox.pesepay.com");
  });

  it("never enables production checkout without an explicit live-verification flag", () => {
    const env = {
      PESEPAY_MODE: "production",
      PAYMENTS_ENABLED: "true",
      PESEPAY_INTEGRATION_KEY: "production-integration",
      PESEPAY_ENCRYPTION_KEY: key,
    } as NodeJS.ProcessEnv;
    expect(resolvePaymentServerConfig(env).enabled).toBe(false);
    expect(
      resolvePaymentServerConfig({
        ...env,
        PESEPAY_LIVE_VERIFIED: "true",
      }).enabled,
    ).toBe(true);
  });
});
