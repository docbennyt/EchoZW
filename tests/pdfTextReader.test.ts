// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readPdfText } from "../server/pdfTextReader";
import {
  buildPersonalTimetableModel,
  buildPersonalTimetablePdf,
} from "../src/domain/personalTimetableExport";

describe("text-layer PDF timetable extraction", () => {
  it("extracts text from a deterministic generated PDF", async () => {
    const model = buildPersonalTimetableModel({
      institution: "Harare Institute of Technology",
      programme: "Industrial and Manufacturing Engineering",
      classGroup: "Part 1",
      academicPeriod: "Semester I",
      versionNumber: 1,
      publishedAt: "2026-10-08T00:00:00.000Z",
      events: [
        {
          stableSessionKey: "ime-ics1110",
          uid: "ime-ics1110@example.test",
          courseCode: "ICS1110",
          courseName: "Introduction to Computer Science",
          summary: "Introduction to Computer Science",
          description: "",
          sessionType: "class",
          lecturer: null,
          notes: null,
          weekday: 1,
          recurrenceDay: "MO",
          recurring: true,
          exceptionDate: null,
          exDates: [],
          firstDate: "2026-09-07",
          startTime: "08:00:00",
          endTime: "10:00:00",
          localStart: "20260907T080000",
          localEnd: "20260907T100000",
          firstStartUtc: "20260907T060000Z",
          firstEndUtc: "20260907T080000Z",
          recurrenceUntilUtc: "20261201T215959Z",
          venue: "A/H",
          lastModifiedUtc: "20260901T080000Z",
          sequence: 1,
          alarms: [],
        },
      ],
    });

    const extracted = await readPdfText(
      Buffer.from(buildPersonalTimetablePdf(model)),
    );

    expect(extracted.pageCount).toBe(1);
    expect(extracted.text).toContain(
      "Industrial and Manufacturing Engineering",
    );
    expect(extracted.text).toContain("ICS1110");
  });

  it("extracts the local IME text-PDF canary when available", async () => {
    const path =
      "C:/Users/User/Downloads/IME_FINAL_1st_Sem_TIMETABLE_WITH_VENUES_2025-2026_125351.pdf";
    if (!existsSync(path)) return;

    const extracted = await readPdfText(readFileSync(path));

    expect(extracted.text).toContain("COURSE CODE");
    expect(extracted.text).toContain("ICS1110");
    expect(extracted.text).toContain("CPSE/IME/PTE/MTE");
    expect(extracted.text).toContain("Part 1 - Free/Library");
  });
});
