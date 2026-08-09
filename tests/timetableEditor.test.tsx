import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  getTimetable: vi.fn(),
  createTimetableSession: vi.fn(),
  updateTimetableSession: vi.fn(),
  deleteTimetableSession: vi.fn(),
  publishTimetable: vi.fn(),
}));

vi.mock("../src/api/pilotAdmin", async () => {
  const actual = await vi.importActual<typeof import("../src/api/pilotAdmin")>(
    "../src/api/pilotAdmin",
  );
  return {
    ...actual,
    getTimetable: apiMocks.getTimetable,
    createTimetableSession: apiMocks.createTimetableSession,
    updateTimetableSession: apiMocks.updateTimetableSession,
    deleteTimetableSession: apiMocks.deleteTimetableSession,
    publishTimetable: apiMocks.publishTimetable,
  };
});

import { TimetableEditorPage } from "../src/pilotMvp";

function makeSession(overrides: Partial<{
  id: string;
  timetableVersionId: string;
  stableSessionKey: string;
  courseCode: string;
  courseName: string;
  weekday: number;
  startTime: string;
  endTime: string;
  venue: string | null;
  lecturer: string | null;
  sessionType: string | null;
  notes: string | null;
}> = {}) {
  return {
    id: "session-1",
    timetableVersionId: "version-1",
    stableSessionKey: "ics1101__2__14:00:00__16:00:00__lecture",
    courseCode: "ICS1101",
    courseName: "Principles of Programming Languages",
    weekday: 2,
    startTime: "14:00:00",
    endTime: "16:00:00",
    venue: "N111 LAB",
    lecturer: "Ms Dube",
    sessionType: "Lecture",
    notes: null,
    ...overrides,
  };
}

function editorFixture(sessions = [makeSession()]) {
  return {
    timetable: {
      id: "tt-1",
      publicSlug: "hit-cs-1-1-august-2026",
      institutionId: "inst-1",
      institutionName: "Harare Institute of Technology",
      programmeId: "prog-1",
      programmeName: "BTech Computer Science",
      classGroupId: "class-1",
      classGroupLabel: "1.1",
      academicPeriodId: "period-1",
      academicPeriodName: "August Semester 2026",
      academicPeriodStartsOn: "2026-08-10",
      academicPeriodEndsOn: "2026-12-10",
      currentPublishedVersionId: null,
    },
    activeVersion: {
      id: "version-1",
      versionNumber: 1,
      status: "draft" as const,
      publishedAt: null,
      changeSummary: "Initial draft",
      createdAt: "2026-08-09T08:00:00.000Z",
      sessionCount: sessions.length,
    },
    versions: [],
    courseMemory: [
      {
        courseCode: "ICS1101",
        courseName: "Principles of Programming Languages",
        lecturerSuggestions: ["Ms Dube"],
        venueSuggestions: ["N111 LAB", "N112 LAB"],
        sessionTypeSuggestions: ["Lecture"],
      },
    ],
    sessions,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function openTuesdayForm() {
  fireEvent.click(await screen.findByRole("button", { name: /Add Tuesday class/i }));
}

async function fillNewSessionForm(overrides?: Partial<{
  courseCode: string;
  courseName: string;
  start: string;
  end: string;
}>) {
  fireEvent.change(screen.getByLabelText("Course code"), {
    target: { value: overrides?.courseCode ?? "ICS1102" },
  });
  fireEvent.change(screen.getByLabelText("Course name"), {
    target: { value: overrides?.courseName ?? "Operating Systems" },
  });
  fireEvent.change(screen.getByLabelText("Start"), {
    target: { value: overrides?.start ?? "10:15" },
  });
  fireEvent.change(screen.getByLabelText("End"), {
    target: { value: overrides?.end ?? "12:15" },
  });
}

describe("timetable editor manual entry flow", () => {
  beforeEach(() => {
    apiMocks.getTimetable.mockReset();
    apiMocks.createTimetableSession.mockReset();
    apiMocks.updateTimetableSession.mockReset();
    apiMocks.deleteTimetableSession.mockReset();
    apiMocks.publishTimetable.mockReset();
    vi.restoreAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMocks.getTimetable.mockResolvedValue({ timetable: editorFixture() });
  });

  it("shows the initial loading skeleton only before the first editor payload arrives", async () => {
    const initialLoad = deferred<{ timetable: ReturnType<typeof editorFixture> }>();
    apiMocks.getTimetable.mockReturnValueOnce(initialLoad.promise);

    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);

    expect(screen.getByLabelText("Loading timetable")).toBeInTheDocument();

    initialLoad.resolve({ timetable: editorFixture() });

    expect(await screen.findByText("Weekly classes")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading timetable")).toBeNull();
  });

  it("preselects the clicked weekday in the add-class form", async () => {
    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);

    await openTuesdayForm();

    expect(screen.getByLabelText("Day")).toHaveValue("2");
  });

  it("does not persist anything when Duplicate is clicked", async () => {
    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Duplicate" }));

    expect(apiMocks.createTimetableSession).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Course code")).toHaveValue("ICS1101");
    expect(screen.getByLabelText("Course name")).toHaveValue(
      "Principles of Programming Languages",
    );
  });

  it("disables resubmit while a save is pending and sends one mutation", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;
    apiMocks.createTimetableSession.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);
    await openTuesdayForm();
    await fillNewSessionForm();

    const saveButton = screen.getByRole("button", { name: /Add class/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(apiMocks.createTimetableSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Saving/i })).toBeDisabled();

    resolveRequest?.({
      session: makeSession({
        id: "session-2",
        stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        startTime: "10:15:00",
        endTime: "12:15:00",
        venue: null,
        lecturer: null,
        sessionType: null,
      }),
    });

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /Saving/i })).toBeNull(),
    );
  });

  it("fills the linked course fields from a code suggestion without overwriting a typed lecturer", async () => {
    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);
    await openTuesdayForm();

    fireEvent.change(screen.getByLabelText("Lecturer"), {
      target: { value: "Custom Lecturer" },
    });
    fireEvent.change(screen.getByLabelText("Course code"), {
      target: { value: "ICS1" },
    });

    fireEvent.click(await screen.findByRole("button", { name: /ICS1101/i }));

    expect(screen.getByLabelText("Course code")).toHaveValue("ICS1101");
    expect(screen.getByLabelText("Course name")).toHaveValue(
      "Principles of Programming Languages",
    );
    expect(screen.getByLabelText("Lecturer")).toHaveValue("Custom Lecturer");
  });

  it("keeps the editor mounted and add buttons usable during background refresh after save", async () => {
    const backgroundRefresh = deferred<{ timetable: ReturnType<typeof editorFixture> }>();
    apiMocks.getTimetable
      .mockResolvedValueOnce({ timetable: editorFixture() })
      .mockReturnValueOnce(backgroundRefresh.promise);
    apiMocks.createTimetableSession.mockResolvedValue({
      session: makeSession({
        id: "session-2",
        stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
        courseCode: "ICS1102",
        courseName: "Operating Systems",
        startTime: "10:15:00",
        endTime: "12:15:00",
        venue: null,
        lecturer: null,
        sessionType: null,
      }),
    });

    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);
    await openTuesdayForm();
    await fillNewSessionForm();

    fireEvent.click(screen.getByRole("button", { name: /Add class/i }));

    expect(await screen.findByText("ICS1102")).toBeInTheDocument();
    expect(screen.queryByLabelText("Loading timetable")).toBeNull();
    expect(screen.getByText("Syncing...")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add Monday class/i })).toBeEnabled();

    backgroundRefresh.resolve({
      timetable: editorFixture([
        makeSession(),
        makeSession({
          id: "session-2",
          stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          startTime: "10:15:00",
          endTime: "12:15:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
      ]),
    });

    await waitFor(() => expect(screen.queryByText("Syncing...")).toBeNull());
  });

  it("removes only the deleted session without showing the initial loading state", async () => {
    const backgroundRefresh = deferred<{ timetable: ReturnType<typeof editorFixture> }>();
    apiMocks.getTimetable
      .mockResolvedValueOnce({ timetable: editorFixture() })
      .mockReturnValueOnce(backgroundRefresh.promise);
    apiMocks.deleteTimetableSession.mockResolvedValue({
      ok: true,
      deletedSessionId: "session-1",
    });

    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);

    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(
        screen.queryByText("Principles of Programming Languages"),
      ).toBeNull(),
    );
    expect(screen.queryByLabelText("Loading timetable")).toBeNull();
    expect(screen.getByRole("button", { name: /Add Tuesday class/i })).toBeEnabled();

    backgroundRefresh.resolve({ timetable: editorFixture([]) });
    await waitFor(() => expect(screen.queryByText("Syncing...")).toBeNull());
  });

  it("keeps newer session state when an older background refresh resolves last", async () => {
    const firstRefresh = deferred<{ timetable: ReturnType<typeof editorFixture> }>();
    const secondRefresh = deferred<{ timetable: ReturnType<typeof editorFixture> }>();
    apiMocks.getTimetable
      .mockResolvedValueOnce({ timetable: editorFixture() })
      .mockReturnValueOnce(firstRefresh.promise)
      .mockReturnValueOnce(secondRefresh.promise);
    apiMocks.createTimetableSession
      .mockResolvedValueOnce({
        session: makeSession({
          id: "session-2",
          stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          startTime: "10:15:00",
          endTime: "12:15:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
      })
      .mockResolvedValueOnce({
        session: makeSession({
          id: "session-3",
          stableSessionKey: "ics1103__2__12:30:00__14:00:00__session",
          courseCode: "ICS1103",
          courseName: "Discrete Mathematics",
          startTime: "12:30:00",
          endTime: "14:00:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
      });

    render(<TimetableEditorPage accessToken="token" timetableId="tt-1" />);

    await openTuesdayForm();
    await fillNewSessionForm();
    fireEvent.click(screen.getByRole("button", { name: /Save & add another/i }));

    expect(await screen.findByText("ICS1102")).toBeInTheDocument();
    expect(screen.getByLabelText("Course code")).toHaveFocus();

    await fillNewSessionForm({
      courseCode: "ICS1103",
      courseName: "Discrete Mathematics",
      start: "12:30",
      end: "14:00",
    });
    fireEvent.click(screen.getByRole("button", { name: /Save & add another/i }));

    expect(await screen.findByText("ICS1103")).toBeInTheDocument();

    secondRefresh.resolve({
      timetable: editorFixture([
        makeSession(),
        makeSession({
          id: "session-2",
          stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          startTime: "10:15:00",
          endTime: "12:15:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
        makeSession({
          id: "session-3",
          stableSessionKey: "ics1103__2__12:30:00__14:00:00__session",
          courseCode: "ICS1103",
          courseName: "Discrete Mathematics",
          startTime: "12:30:00",
          endTime: "14:00:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
      ]),
    });
    firstRefresh.resolve({
      timetable: editorFixture([
        makeSession(),
        makeSession({
          id: "session-2",
          stableSessionKey: "ics1102__2__10:15:00__12:15:00__session",
          courseCode: "ICS1102",
          courseName: "Operating Systems",
          startTime: "10:15:00",
          endTime: "12:15:00",
          venue: null,
          lecturer: null,
          sessionType: null,
        }),
      ]),
    });

    await waitFor(() => expect(screen.getByText("ICS1103")).toBeInTheDocument());
    expect(screen.queryByLabelText("Loading timetable")).toBeNull();
  });
});
