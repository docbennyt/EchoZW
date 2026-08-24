import { describe, expect, it } from "vitest";
import {
  applyCourseSuggestion,
  buildCourseMemoryEntries,
  findCourseSuggestions,
  mergeCourseSuggestion,
} from "../src/domain/courseMemory";

describe("course memory helpers", () => {
  it("builds deduplicated course memory from persisted sessions", () => {
    const entries = buildCourseMemoryEntries([
      {
        courseCode: "ICS1101",
        courseName: "Principles of Programming Languages",
        lecturer: "Ms Dube",
        venue: "N111 LAB",
        sessionType: "Lecture",
      },
      {
        courseCode: "ICS1101",
        courseName: "Principles of Programming Languages",
        lecturer: "Ms Dube",
        venue: "N112 LAB",
        sessionType: "Lecture",
      },
    ]);

    expect(entries).toEqual([
      {
        courseCode: "ICS1101",
        courseName: "Principles of Programming Languages",
        lecturerSuggestions: ["Ms Dube"],
        venueSuggestions: ["N111 LAB", "N112 LAB"],
        sessionTypeSuggestions: ["Lecture"],
      },
    ]);
  });

  it("matches suggestions from either code or name", () => {
    const entries = buildCourseMemoryEntries([
      {
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        lecturer: "Mr Mashoko",
        venue: "N109",
        sessionType: "Lecture",
      },
    ]);

    expect(findCourseSuggestions(entries, "ICS1", "code")[0]?.courseCode).toBe(
      "ICS1102",
    );
    expect(
      findCourseSuggestions(entries, "Operating", "name")[0]?.courseCode,
    ).toBe("ICS1102");
  });

  it("fills code and name and only fills lecturer when the field is empty", () => {
    const suggestion = {
      courseCode: "ICS1101",
      courseName: "Principles of Programming Languages",
      lecturerSuggestions: ["Ms Dube"],
      venueSuggestions: ["N111 LAB"],
      sessionTypeSuggestions: ["Lecture"],
    };

    expect(
      applyCourseSuggestion(
        {
          courseCode: "ICS",
          courseName: "",
          weekday: "2",
          startTime: "",
          endTime: "",
          venue: "",
          lecturer: "",
          sessionType: "",
          notes: "",
        },
        suggestion,
      ),
    ).toMatchObject({
      courseCode: "ICS1101",
      courseName: "Principles of Programming Languages",
      lecturer: "Ms Dube",
      sessionType: "Lecture",
      venue: "",
    });

    expect(
      applyCourseSuggestion(
        {
          courseCode: "",
          courseName: "",
          weekday: "2",
          startTime: "",
          endTime: "",
          venue: "",
          lecturer: "Custom Lecturer",
          sessionType: "",
          notes: "",
        },
        suggestion,
      ).lecturer,
    ).toBe("Custom Lecturer");
  });

  it("learns from a newly saved session immediately", () => {
    const merged = mergeCourseSuggestion([], {
      courseCode: "ICS1103",
      courseName: "Fundamentals of Digital Electronics",
      lecturer: "Mr Ndlovu / Ms Jonha",
      venue: "N101",
      sessionType: "Lecture",
    });

    expect(merged[0]).toMatchObject({
      courseCode: "ICS1103",
      courseName: "Fundamentals of Digital Electronics",
      lecturerSuggestions: ["Mr Ndlovu / Ms Jonha"],
      venueSuggestions: ["N101"],
    });
  });
});
