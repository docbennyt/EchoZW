import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";
const api = vi.hoisted(() => ({ deactivateTimetablePause: vi.fn() }));
vi.mock("../src/api/academicPauses", () => api);
import { ActiveAcademicPauseNotice } from "../src/ClassRepAcademicPauseControl";

it("warns a Class Rep when resuming succeeds but Google delivery was skipped", async () => {
  api.deactivateTimetablePause.mockResolvedValue({
    googleCalendarSync: {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: true,
    },
  });
  const onMessage = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(undefined);
  const timetable: PublicTimetable = {
    timetableId: "qa-timetable",
    publicSlug: "qa",
    institution: "QA",
    institutionShortName: "QA",
    institutionTimezone: "Africa/Harare",
    programme: "QA",
    classGroup: "QA",
    academicPeriod: "QA",
    startsOn: "2026-08-01",
    endsOn: "2026-12-01",
    publishedAt: "2026-08-01T00:00:00Z",
    versionNumber: 1,
    sessions: [],
    pauses: [
      {
        id: "qa-pause",
        scopeType: "timetable",
        stableSessionKey: null,
        startsOn: "2026-10-26",
        endsOn: "2026-11-30",
        allDay: true,
        startsAt: null,
        endsAt: null,
        reason: "swot_week",
        label: "SWOT Week",
        active: true,
        createdAt: "2026-10-26T00:00:00Z",
      },
    ],
  };
  render(
    <ActiveAcademicPauseNotice
      accessToken="synthetic-test-only"
      timetable={timetable}
      assignment={{
        id: "qa-assignment",
        timetableId: "qa-timetable",
        publicSlug: "qa",
        institutionName: "QA",
        programmeName: "QA",
        classGroupLabel: "QA",
        academicPeriodName: "QA",
      }}
      onMessage={onMessage}
      onRefresh={onRefresh}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  await waitFor(() =>
    expect(onMessage).toHaveBeenCalledWith(
      expect.stringContaining("Google Calendar delivery is paused"),
    ),
  );
  expect(onMessage.mock.calls.flat().join(" ")).not.toContain("will receive");
  expect(onRefresh).toHaveBeenCalledOnce();
});
