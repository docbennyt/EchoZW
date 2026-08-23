import { describe, expect, it } from "vitest";
import {
  getRelaySecretForSourceKey,
  HIT_TIMETABLE_SOURCE_KEY,
  normalizeRelaySecret,
} from "../server/sourceSnapshotConfig";

describe("source snapshot config", () => {
  it("normalizes the relay secret at the configuration boundary", () => {
    expect(normalizeRelaySecret("  test-secret  ")).toBe("test-secret");
    expect(normalizeRelaySecret("   ")).toBeUndefined();
    expect(normalizeRelaySecret(undefined)).toBeUndefined();
  });

  it("uses the normalized production relay secret for the HIT source", () => {
    expect(
      getRelaySecretForSourceKey(HIT_TIMETABLE_SOURCE_KEY, {
        HIT_TIMETABLE_RELAY_SECRET: "  test-secret  ",
      }),
    ).toBe("test-secret");
  });
});
