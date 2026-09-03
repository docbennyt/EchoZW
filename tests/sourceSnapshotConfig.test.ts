import { describe, expect, it } from "vitest";
import {
  getRelaySecretForSource,
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

  it("loads the relay secret through the source row env-name indirection", () => {
    expect(
      getRelaySecretForSource(
        {
          relaySecretEnvName: "CUSTOM_SOURCE_SECRET",
          sourceKey: "future-source",
        },
        {
          CUSTOM_SOURCE_SECRET: "  future-secret  ",
        } as NodeJS.ProcessEnv,
      ),
    ).toBe("future-secret");
  });

  it("falls back to the existing HIT source key for backwards compatibility", () => {
    expect(
      getRelaySecretForSource(
        {
          relaySecretEnvName: null,
          sourceKey: HIT_TIMETABLE_SOURCE_KEY,
        },
        {
          HIT_TIMETABLE_RELAY_SECRET: "legacy-secret",
        },
      ),
    ).toBe("legacy-secret");
  });
});
