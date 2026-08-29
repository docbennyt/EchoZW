import { describe, expect, it, vi } from "vitest";

import { runSourceReconciliation } from "../server/sourceReconciliationRepository";

describe("source reconciliation repository service", () => {
  it("proves compare-only execution without mutating protected publication state", async () => {
    const captureCompareOnlyState = vi
      .fn()
      .mockResolvedValueOnce({
        calendarSubscriptionIds: ["sub-1"],
        currentPublishedVersionId: "version-1",
        feedTokenIds: ["feed-1"],
        publishedSessionIds: ["session-1"],
        syncRecordIds: ["sync-1"],
        timetableId: "timetable-1",
        timetableVersionIds: ["version-1"],
      })
      .mockResolvedValueOnce({
        calendarSubscriptionIds: ["sub-1"],
        currentPublishedVersionId: "version-1",
        feedTokenIds: ["feed-1"],
        publishedSessionIds: ["session-1"],
        syncRecordIds: ["sync-1"],
        timetableId: "timetable-1",
        timetableVersionIds: ["version-1"],
      });

    const result = await runSourceReconciliation(
      {
        sourceCohortCode: "CS.1",
        sourceKey: "hit-sist-master-sem1-2026",
      },
      {
        captureCompareOnlyState,
        loadBinding: vi.fn().mockResolvedValue({
          active: true,
          id: "binding-1",
          sourceCohortCode: "CS.1",
          sourceKey: "hit-sist-master-sem1-2026",
          targetAcademicPeriodName: "August Semester 2026",
          targetClassGroupLabel: "1.1",
          targetPublicSlug: "hit-cs-1-1-august-2026",
        }),
        loadLatestSuccessfulParse: vi.fn().mockResolvedValue({
          parseRunId: "parse-run-1",
          parserVersion: "hit-sist-google-docs-v1",
          snapshotId: "snapshot-1",
          sourceCandidates: [
            {
              candidateId: "source-1",
              cohortCode: "CS.1",
              courseCode: "ICS1101",
              courseExpressionRaw: "ICS1101",
              courseName: "Introduction to Computer Science",
              endTime: "12:15:00",
              lecturer: "Dr Ncube",
              parseRunId: "parse-run-1",
              parserProvenance: {
                columnIndex: 2,
                rawCourse: "ICS1101",
                rawText: "CS.1 ICS1101 - N112 LAB",
                rawTime: "10:15 - 12:15",
                rawVenue: "N112 LAB",
                rawWeekday: "TUESDAY",
                rowIndex: 3,
                sourceCell: "CS.1 ICS1101 - N112 LAB",
                tableIndex: 0,
                tabId: "tab-1",
                tabTitle: "Semester 1",
              },
              parserVersion: "hit-sist-google-docs-v1",
              parseWarnings: [],
              reviewStatus: "valid",
              snapshotId: "snapshot-1",
              sourceCandidateKey: "0:3:2:CS.1:ICS1101:10:15:00:12:15:00",
              sourceKey: "hit-sist-master-sem1-2026",
              startTime: "10:15:00",
              venue: "N112 LAB",
              weekday: 2,
            },
          ],
          sourceKey: "hit-sist-master-sem1-2026",
        }),
        loadPublishedTimetable: vi.fn().mockResolvedValue({
          academicPeriodId: "period-1",
          academicPeriodName: "August Semester 2026",
          classGroupLabel: "1.1",
          institutionName: "HIT",
          programmeName: "BTech Computer Science",
          publishedVersionId: "version-1",
          sessions: [
            {
              courseCode: "ICS1101",
              courseName: "Introduction to Computer Science",
              endTime: "12:15:00",
              lecturer: "Dr Ncube",
              notes: null,
              publishedVersionId: "version-1",
              sessionId: "session-1",
              sessionType: null,
              stableSessionKey: "ics1101__2__10:15:00__12:15:00__session",
              startTime: "10:15:00",
              timetableId: "timetable-1",
              venue: "N112 LAB",
              weekday: 2,
            },
          ],
          timetableId: "timetable-1",
        }),
      },
    );

    expect(result.summary).toEqual({
      ambiguous: 0,
      changed: 0,
      currentOnly: 0,
      matched: 1,
      sourceOnly: 0,
    });
    expect(result.zeroMutationProof.noMutationsObserved).toBe(true);
    expect(captureCompareOnlyState).toHaveBeenCalledTimes(2);
  });
});
