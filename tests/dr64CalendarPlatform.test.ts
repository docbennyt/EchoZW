import { describe, expect, it } from "vitest";
import {
  detectCalendarPlatform,
  orderedCalendarDestinations,
} from "../src/domain/device";

describe("DR-64 calendar platform ordering", () => {
  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/604.1",
      5,
      "ios",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) Safari/605.1.15",
      0,
      "macos",
    ],
    ["Mozilla/5.0 (Linux; Android 15; Pixel 9)", 5, "android"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0, "windows"],
    ["Mozilla/5.0 (X11; Linux x86_64)", 0, "linux"],
    ["UnknownBrowser/1.0", 0, "unknown"],
  ])("detects platform for %s", (ua, touchPoints, expected) => {
    expect(detectCalendarPlatform(ua as string, touchPoints as number)).toBe(
      expected,
    );
  });

  it("puts Apple first only on Apple platforms and Advanced last everywhere", () => {
    expect(orderedCalendarDestinations("ios")).toEqual([
      "apple",
      "google",
      "advanced",
    ]);
    expect(orderedCalendarDestinations("macos")).toEqual([
      "apple",
      "google",
      "advanced",
    ]);
    for (const platform of [
      "android",
      "windows",
      "linux",
      "unknown",
    ] as const) {
      expect(orderedCalendarDestinations(platform)).toEqual([
        "google",
        "apple",
        "advanced",
      ]);
    }
  });
});
