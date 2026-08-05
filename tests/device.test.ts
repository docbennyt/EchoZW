import { describe, expect, it } from "vitest";
import { detectDevice, orderedProvidersForDevice } from "../src/domain/device";

describe("device calendar provider ordering", () => {
  it("prioritizes Apple Calendar on iPhone", () => {
    expect(
      detectDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"),
    ).toBe("ios");
    expect(orderedProvidersForDevice("ios")[0]).toBe("apple_subscription");
  });

  it("prioritizes Google Calendar on Android", () => {
    expect(detectDevice("Mozilla/5.0 (Linux; Android 14; Pixel)")).toBe(
      "android",
    );
    expect(orderedProvidersForDevice("android")[0]).toBe("google_api");
  });
});
