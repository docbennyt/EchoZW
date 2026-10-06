import { describe, expect, it } from "vitest";
import { demandKeyForRequest } from "../server/growthCaptureRepository";

describe("missing timetable acquisition queue", () => {
  it("normalizes duplicate student requests into the same demand key", () => {
    const first = demandKeyForRequest({
      institutionName: "Harare   Institute of Technology",
      programmeName: " BTech Software Engineering ",
      classGroup: "SE 4.1",
      academicPeriod: "August Semester 2026",
    });
    const duplicate = demandKeyForRequest({
      institutionName: "harare institute of technology",
      programmeName: "btech software engineering",
      classGroup: " se 4.1 ",
      semesterName: "August Semester 2026",
    });

    expect(first).toBe(duplicate);
    expect(first).toBe(
      "harare institute of technology|btech software engineering|se 4.1|august semester 2026",
    );
  });
});
