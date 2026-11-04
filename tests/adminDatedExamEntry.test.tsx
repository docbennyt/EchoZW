import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createExtraClassUpdate: vi.fn(),
  fetchPublicTimetable: vi.fn(),
}));

vi.mock("../src/api/correctionMutations", async () => ({
  createExtraClassUpdate: api.createExtraClassUpdate,
}));
vi.mock("../src/api/publicTimetable", async () => ({
  fetchPublicTimetable: api.fetchPublicTimetable,
}));

import { AdminDatedExamEntry } from "../src/AdminDatedExamEntry";

const props = {
  accessToken: "test-editor-credential",
  timetableId: "timetable-1",
  publicSlug: "published-class",
  periodStartsOn: "2026-08-01",
  periodEndsOn: "2026-12-18",
  hasPublishedVersion: true,
};

const published = {
  timetableId: props.timetableId,
  sessions: [{ courseCode: "ISE1101", courseName: "Programming Languages" }],
  exceptions: [],
};

function fillExam() {
  fireEvent.change(screen.getByLabelText("Exam date"), {
    target: { value: "2026-11-04" },
  });
  fireEvent.change(screen.getByLabelText("Course code"), {
    target: { value: "ISE 1101" },
  });
  fireEvent.change(screen.getByLabelText("Course name"), {
    target: { value: "Programming Languages" },
  });
  fireEvent.change(screen.getByLabelText("Start time"), {
    target: { value: "09:00" },
  });
  fireEvent.change(screen.getByLabelText("End time"), {
    target: { value: "12:00" },
  });
  fireEvent.change(screen.getByLabelText("Exam venue"), {
    target: { value: "Engineering Hall" },
  });
  fireEvent.change(screen.getByLabelText("Verified source and page"), {
    target: { value: "HIT Examinations Office final memo, page 5" },
  });
}

describe("DR-179 admin dated examination entry", () => {
  beforeEach(() => {
    api.createExtraClassUpdate.mockReset();
    api.fetchPublicTimetable.mockReset();
    vi.stubGlobal("crypto", { randomUUID: () => "c68cfccd-3289-455b-8ae3-e54fa423889b" });
    api.fetchPublicTimetable.mockResolvedValue(published);
    api.createExtraClassUpdate.mockResolvedValue({ exception: { id: "exam-1" }, mutationOutcome: "created" });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits a one-off Examination through the scoped authenticated API, never the recurring editor", async () => {
    api.fetchPublicTimetable
      .mockResolvedValueOnce(published)
      .mockResolvedValueOnce({
        ...published,
        exceptions: [{ id: "exam-1", active: true }],
      });
    render(<AdminDatedExamEntry {...props} />);
    fillExam();
    fireEvent.click(screen.getByRole("button", { name: "Save dated examination" }));

    await waitFor(() => expect(api.createExtraClassUpdate).toHaveBeenCalledTimes(1));
    expect(api.createExtraClassUpdate).toHaveBeenCalledWith(
      props.accessToken,
      props.timetableId,
      "c68cfccd-3289-455b-8ae3-e54fa423889b",
      expect.objectContaining({
        exceptionDate: "2026-11-04",
        exceptionType: "extra",
        stableSessionKey: null,
        courseCode: "ISE 1101",
        courseName: "Programming Languages",
        startTime: "09:00",
        endTime: "12:00",
        venue: "Engineering Hall",
        sessionType: "Examination",
        reason: "Verified examination timetable",
        provenance: "HIT Examinations Office final memo, page 5",
      }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Verify the original ICS feed");
  });

  it("rejects an exam for a course absent from the published class", async () => {
    render(<AdminDatedExamEntry {...props} />);
    fillExam();
    fireEvent.change(screen.getByLabelText("Course code"), {
      target: { value: "ANOTHER101" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dated examination" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not in this published class");
    expect(api.createExtraClassUpdate).not.toHaveBeenCalled();
  });

  it("does not duplicate an existing dated exam in the same published class", async () => {
    api.fetchPublicTimetable.mockResolvedValue({
      ...published,
      exceptions: [{
        id: "already-published",
        active: true,
        revokedAt: null,
        supersededAt: null,
        exceptionType: "extra",
        sessionType: "Examination",
        exceptionDate: "2026-11-04",
        courseCode: "ISE1101",
      }],
    });
    render(<AdminDatedExamEntry {...props} />);
    fillExam();
    fireEvent.click(screen.getByRole("button", { name: "Save dated examination" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(api.createExtraClassUpdate).not.toHaveBeenCalled();
  });

  it("does not expose writes before the class timetable is published", () => {
    render(<AdminDatedExamEntry {...props} hasPublishedVersion={false} />);
    expect(screen.getByText(/Publish the class timetable/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save dated examination" })).toBeNull();
  });

  it("rejects an invalid time order and does not issue an API request", async () => {
    render(<AdminDatedExamEntry {...props} />);
    fillExam();
    fireEvent.change(screen.getByLabelText("End time"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save dated examination" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("start/end times");
    expect(api.fetchPublicTimetable).not.toHaveBeenCalled();
    expect(api.createExtraClassUpdate).not.toHaveBeenCalled();
  });
});
