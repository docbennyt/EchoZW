import { describe, expect, it } from "vitest";
import { getNextEvent } from "../src/domain/nextEvent";
import { demoTimetable } from "../src/domain/timetableData";

describe("next lecture calculation", () => {
  it("finds the first lecture on semester morning", () => {
    const next = getNextEvent(demoTimetable, new Date("2026-08-10T07:15:00"));
    expect(next?.event.courseCode).toBe("SE201");
    expect(next?.start.getHours()).toBe(8);
    expect(next?.start.getMinutes()).toBe(0);
  });

  it("moves across midnight to the next matching day", () => {
    const next = getNextEvent(demoTimetable, new Date("2026-08-10T23:30:00"));
    expect(next?.event.courseCode).toBe("DB202");
  });

  it("respects semester end boundaries", () => {
    const next = getNextEvent(demoTimetable, new Date("2026-12-05T08:00:00"));
    expect(next).toBeUndefined();
  });
});
