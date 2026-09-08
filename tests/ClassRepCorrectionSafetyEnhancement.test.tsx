import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClassRepCorrectionWorkspace } from "../src/ClassRepCorrectionSafetyEnhancement";
import type {
  TimetableCorrectionDirective,
  TimetableMutationOutcome,
} from "../src/api/pilotTypes";
import {
  createRecurringClassUpdate,
  dedupeRecurringClassUpdates,
  listClassUpdates,
} from "../src/api/correctionMutations";
import { fetchPublicTimetable } from "../src/api/publicTimetable";

vi.mock("../src/api/correctionMutations", async () => {
  const actual = await vi.importActual<
    typeof import("../src/api/correctionMutations")
  >("../src/api/correctionMutations");
  return {
    ...actual,
    createExtraClassUpdate: vi.fn(),
    createRecurringClassUpdate: vi.fn(),
    dedupeRecurringClassUpdates: vi.fn(),
    dedupeSessionExceptions: vi.fn(),
    editRecurringClassUpdate: vi.fn(),
    editSessionException: vi.fn(),
    listClassUpdates: vi.fn(),
    restoreRecurringClassUpdate: vi.fn(),
    restoreSessionException: vi.fn(),
    revokeRecurringClassUpdate: vi.fn(),
    revokeSessionException: vi.fn(),
  };
});

vi.mock("../src/api/publicTimetable", () => ({
  fetchPublicTimetable: vi.fn(),
}));

const assignment = {
  id: "assignment-1",
  timetableId: "timetable-1",
  publicSlug: "bit-11",
  institutionName: "Harare Institute of Technology",
  programmeName: "Btech Information Technology",
  classGroupLabel: "Class 1.1",
  academicPeriodName: "August Semester 2026",
};

const emptyTimetable = {
  timetableId: "timetable-1",
  publicSlug: "bit-11",
  institution: "Harare Institute of Technology",
  institutionShortName: "HIT",
  institutionTimezone: "Africa/Harare",
  programme: "Btech Information Technology",
  classGroup: "Class 1.1",
  academicPeriod: "August Semester 2026",
  startsOn: "2026-08-01",
  endsOn: "2026-12-20",
  publishedAt: "2026-09-07T12:00:00.000Z",
  versionNumber: 1,
  sessions: [],
};

function correction(id: string): TimetableCorrectionDirective {
  return {
    id,
    stableSessionKey: null,
    action: "add",
    sourceMayReplace: false,
    pinned: true,
    courseCode: "ICS1103",
    courseName: "Fundamental of Digital Electronics",
    weekday: 2,
    startTime: "08:00:00",
    endTime: "10:00:00",
    venue: "N110",
    lecturer: null,
    sessionType: "Lecture",
    notes: null,
    reason: "Missing from master timetable",
    provenance: "Class rep confirmed",
    creatorRole: "class_rep",
    active: true,
    mutationKey: `11111111-1111-4111-8111-11111111111${id.slice(-1)}`,
    semanticFingerprint: "ics1103-tuesday-0800-n110",
    revision: 1,
    supersedesId: null,
    replacedById: null,
    revokedAt: null,
    supersededAt: null,
    createdAt: "2026-09-07T13:00:00.000Z",
    updatedAt: "2026-09-07T13:00:00.000Z",
  };
}

function mutationResult(
  outcome: TimetableMutationOutcome = "created",
  item = correction("correction-1"),
) {
  return { correction: item, mutationOutcome: outcome };
}

function emptyUpdates() {
  return { corrections: { corrections: [], exceptions: [] } };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
  vi.mocked(fetchPublicTimetable).mockResolvedValue(emptyTimetable);
  vi.mocked(listClassUpdates).mockResolvedValue(emptyUpdates());
});

describe("DR-57 Class Rep cockpit with DR-53 mutation safety", () => {
  it("keeps mutation forms behind focused quick actions instead of rendering a CRUD wall", async () => {
    render(
      <ClassRepCorrectionWorkspace
        accessToken="token"
        assignment={assignment}
        reloadAfterMutation={false}
      />,
    );

    await screen.findByText("No active corrections or extra classes.");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("Course code")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Update timetable" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add extra class" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add extra class" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Add extra class",
    });
    expect(within(dialog).getByLabelText("Date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Course code")).toBeInTheDocument();
    expect(
      within(dialog).getByLabelText("Source note (optional)"),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByText("Official information policy"),
    ).toBeNull();
  });

  it("synchronously blocks repeated Save activation while one correction is pending", async () => {
    let resolveSave!: (value: ReturnType<typeof mutationResult>) => void;
    vi.mocked(createRecurringClassUpdate).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );

    render(
      <ClassRepCorrectionWorkspace
        accessToken="token"
        assignment={assignment}
        reloadAfterMutation={false}
      />,
    );

    await screen.findByText("No active corrections or extra classes.");
    fireEvent.click(screen.getByRole("button", { name: "Update timetable" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Update timetable",
    });
    fireEvent.change(within(dialog).getByLabelText("Course code"), {
      target: { value: "ICS1103" },
    });
    fireEvent.change(within(dialog).getByLabelText("Course name"), {
      target: { value: "Fundamental of Digital Electronics" },
    });
    fireEvent.change(within(dialog).getByLabelText("Venue"), {
      target: { value: "N110" },
    });
    fireEvent.change(within(dialog).getByLabelText("Reason"), {
      target: { value: "Missing from master timetable" },
    });

    const save = within(dialog).getByRole("button", {
      name: "Save correction",
    });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(createRecurringClassUpdate).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getByRole("button", { name: "Saving…" }),
    ).toBeDisabled();

    resolveSave(mutationResult());
    await screen.findByText(
      /Saved — timetable updated: ICS1103 · Tuesday 08:00/,
    );
  });

  it("keeps the same mutation key and form values when retrying after a network failure", async () => {
    vi.mocked(createRecurringClassUpdate)
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(mutationResult("replayed"));

    render(
      <ClassRepCorrectionWorkspace
        accessToken="token"
        assignment={assignment}
        reloadAfterMutation={false}
      />,
    );

    await screen.findByText("No active corrections or extra classes.");
    fireEvent.click(screen.getByRole("button", { name: "Update timetable" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Update timetable",
    });
    const courseCode = within(dialog).getByLabelText("Course code");
    const courseName = within(dialog).getByLabelText("Course name");
    const reason = within(dialog).getByLabelText("Reason");
    fireEvent.change(courseCode, { target: { value: "ICS1103" } });
    fireEvent.change(courseName, {
      target: { value: "Fundamental of Digital Electronics" },
    });
    fireEvent.change(reason, {
      target: { value: "Missing from master timetable" },
    });

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save correction" }),
    );
    await screen.findByText("Network unavailable");

    expect(courseCode).toHaveValue("ICS1103");
    const firstKey = vi.mocked(createRecurringClassUpdate).mock.calls[0][2];

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Save correction" }),
    );
    await screen.findByText(/retry reused the original save/i);

    const secondKey = vi.mocked(createRecurringClassUpdate).mock.calls[1][2];
    expect(secondKey).toBe(firstKey);
  });

  it("surfaces the Digital Electronics triple-save group and reduces it to one active update", async () => {
    const triple = [
      correction("correction-1"),
      correction("correction-2"),
      correction("correction-3"),
    ];
    vi.mocked(listClassUpdates)
      .mockResolvedValueOnce({
        corrections: { corrections: triple, exceptions: [] },
      })
      .mockResolvedValue({
        corrections: { corrections: [triple[0]], exceptions: [] },
      });
    vi.mocked(dedupeRecurringClassUpdates).mockResolvedValue({
      dedupeResult: { keptId: triple[0].id, revokedCount: 2 },
      googleCalendarSync: { attempted: 0, succeeded: 0, failed: 0 },
    });

    render(
      <ClassRepCorrectionWorkspace
        accessToken="token"
        assignment={assignment}
        reloadAfterMutation={false}
      />,
    );

    expect(
      await screen.findByText("3 exact copies detected"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Fundamental of Digital Electronics"),
    ).toHaveLength(3);

    fireEvent.click(
      screen.getByRole("button", { name: "Keep one, remove duplicates" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByText("3 exact copies detected"),
      ).not.toBeInTheDocument();
    });
    expect(dedupeRecurringClassUpdates).toHaveBeenCalledWith(
      "token",
      "timetable-1",
      "ics1103-tuesday-0800-n110",
    );
    expect(
      screen.getAllByText("Fundamental of Digital Electronics"),
    ).toHaveLength(1);
    expect(
      screen.getByText(/safely removed 2 duplicate updates/),
    ).toBeInTheDocument();
  });
});
