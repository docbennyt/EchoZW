import { describe, expect, it, vi } from "vitest";

describe("cold calendar timezone construction budget", () => {
  it("reuses formatters across a complete transition scan without changing DST rules", async () => {
    vi.resetModules();
    let constructed = 0;
    const DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
      construct(target, args) {
        constructed += 1;
        return Reflect.construct(target, args);
      },
    });
    vi.stubGlobal(
      "Intl",
      Object.assign(Object.create(Intl), { DateTimeFormat }),
    );
    try {
      const timezone = await import("../src/domain/timezone");
      const lines = timezone.buildVTimezoneLines(
        "Europe/London",
        "2026-01-01",
        "2026-12-31",
      );
      expect(lines).toContain("TZOFFSETTO:+0100");
      expect(lines).toContain("TZOFFSETTO:+0000");
      expect(constructed).toBeLessThanOrEqual(3);
      expect(
        timezone
          .zonedDateTimeToUtc("2026-07-15", "08:00", "Europe/London")
          .toISOString(),
      ).toBe("2026-07-15T07:00:00.000Z");
      expect(constructed).toBeLessThanOrEqual(3);
      expect(timezone.foldIcsLineUtf8("é😀".repeat(30))).toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
