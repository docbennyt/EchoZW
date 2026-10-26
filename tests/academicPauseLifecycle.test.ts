import { describe, expect, it } from "vitest";
import { pauseLifecycle } from "../src/domain/academicPauseLifecycle";

describe("academic pause display lifecycle", () => {
  const today = "2026-10-26";

  it("labels a previously ended pause as historical without requiring a resume", () => {
    expect(pauseLifecycle({ active: true, startsOn: "2026-09-14", endsOn: "2026-09-19" }, today)).toBe("ended");
  });

  it("includes the first and last day of a current pause", () => {
    expect(pauseLifecycle({ active: true, startsOn: today, endsOn: "2026-10-30" }, today)).toBe("current");
    expect(pauseLifecycle({ active: true, startsOn: "2026-10-20", endsOn: today }, today)).toBe("current");
  });

  it("distinguishes future scheduled pauses from current ones", () => {
    expect(pauseLifecycle({ active: true, startsOn: "2026-11-02", endsOn: "2026-11-06" }, today)).toBe("scheduled");
  });

  it("does not display a disabled pause as active even if its dates match", () => {
    expect(pauseLifecycle({ active: false, startsOn: today, endsOn: today }, today)).toBe("disabled");
  });

  it("uses ISO calendar dates, not UTC timestamps, at day boundaries", () => {
    expect(pauseLifecycle({ active: true, startsOn: "2026-10-26", endsOn: "2026-10-26" }, "2026-10-27")).toBe("ended");
  });
});
