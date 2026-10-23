// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AcademicPauseInput } from "../server/academicPauseRepository";
import type { StaffAuthContext } from "../server/supabase/auth";

const state = vi.hoisted(() => ({
  ids: ["tt-1"],
  totalCount: undefined as number | null | undefined,
  failScope: false,
  failTimetable: false,
  failWrite: false,
  saved: [] as Record<string, unknown>[],
}));
vi.mock("../server/supabase/adminClient.js", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      let inserted: Record<string, unknown> | undefined;
      let exactCountRequested = false;
      const query = {
        select: (_columns: string, options?: { count?: string }) => {
          exactCountRequested = options?.count === "exact";
          return query;
        },
        not: () => query,
        eq: () => query,
        insert: (row: Record<string, unknown>) => {
          inserted = row;
          return query;
        },
        single: async () => {
          if (state.failWrite) return { data: null, error: {} };
          state.saved.push(inserted!);
          return { data: { id: "saved-pause", ...inserted }, error: null };
        },
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({
            data: table === "timetables" ? state.ids.map((id) => ({ id })) : [],
            count: !exactCountRequested
              ? null
              : state.totalCount === undefined
                ? state.ids.length
                : state.totalCount,
            error: state.failScope ? { message: "fixture read failed" } : null,
          }).then(resolve),
      };
      return query;
    },
  }),
}));
vi.mock("../src/api/academicPauses", () => ({
  listAcademicPauses: vi.fn(async () => ({ pauses: [] })),
  previewBroadPause: vi.fn(async () => {
    throw new Error("Preview service unavailable");
  }),
  previewTimetablePause: vi.fn(async () => {
    throw new Error("Preview service unavailable");
  }),
  createBroadPause: vi.fn(),
  createTimetablePause: vi.fn(),
}));
vi.mock("../server/pilotRepository.js", () => ({
  getPublishedTimetableById: vi.fn(),
}));
vi.mock("../src/domain/resolvedSchedule.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../src/domain/resolvedSchedule")>();
  return {
    ...original,
    resolveScheduleForDate: vi.fn(original.resolveScheduleForDate),
  };
});

import {
  broadInput,
  createPauseWithImpact,
  previewImpact,
  scopedInput,
} from "../server/academicPauseCore";
import { getPublishedTimetableById } from "../server/pilotRepository";
import { resolveScheduleForDate } from "../src/domain/resolvedSchedule";
import { AdminAcademicPauseControl } from "../src/AdminAcademicPauseControl";
import { ClassRepAcademicPauseAction } from "../src/ClassRepAcademicPauseControl";
import {
  createBroadPause,
  createTimetablePause,
} from "../src/api/academicPauses";

afterEach(cleanup);

const input: AcademicPauseInput = {
  scopeType: "institution",
  institutionId: "institution-1",
  startsOn: "2026-09-14",
  endsOn: "2026-09-20",
  allDay: true,
  reason: "closure",
  label: "Closure",
};
const actor = {
  user: { id: "user" },
  staff: { id: "staff", role: "admin" },
  permissions: { canManageAllTimetables: true },
  assignments: [],
} as unknown as StaffAuthContext;

function timetable(): Awaited<ReturnType<typeof getPublishedTimetableById>> {
  return {
    timetableId: "tt-1",
    publicSlug: "fixture",
    institution: "Fixture",
    institutionShortName: null,
    institutionTimezone: "Africa/Harare",
    programme: "Fixture",
    classGroup: "1",
    academicPeriod: "2026",
    startsOn: null,
    endsOn: null,
    publishedAt: "2026-09-01T00:00:00Z",
    versionNumber: 1,
    corrections: [],
    exceptions: [],
    pauses: [],
    sessions: Array.from({ length: 7 }, (_, index) => ({
      stableSessionKey: `session-${index}`,
      courseCode: "TEST",
      courseName: "Test",
      weekday: index + 1,
      startTime: "08:00:00",
      endTime: "09:00:00",
      venue: null,
      lecturer: null,
      sessionType: null,
      notes: null,
    })),
  };
}

describe("bounded academic pause impact", () => {
  it("rejects February 31 in either date field", () => {
    for (const field of ["startsOn", "endsOn"]) {
      expect(() =>
        broadInput({
          ...input,
          institutionId: "783b2fd0-340d-4ac7-b42a-362029a1cd48",
          [field]: "2026-02-31",
        }),
      ).toThrow();
    }
  });

  it("rejects a leap day in a non-leap year for scoped pauses", () => {
    expect(() =>
      scopedInput("tt-1", {
        ...input,
        scopeType: "timetable",
        startsOn: "2026-02-29",
        endsOn: "2026-02-29",
      }),
    ).toThrow();
  });

  it("accepts a real leap day without changing the pause range", () => {
    expect(
      scopedInput("tt-1", {
        ...input,
        scopeType: "timetable",
        startsOn: "2028-02-29",
        endsOn: "2028-02-29",
      }),
    ).toMatchObject({ startsOn: "2028-02-29", endsOn: "2028-02-29" });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    state.ids = ["tt-1"];
    state.totalCount = undefined;
    state.failScope = false;
    state.failTimetable = false;
    state.failWrite = false;
    state.saved = [];
    vi.mocked(getPublishedTimetableById).mockImplementation(async () => {
      if (state.failTimetable) throw new Error("fixture hydration failed");
      return timetable();
    });
  });

  it("bounds timetable hydration while retaining all actual scope IDs", async () => {
    state.ids = Array.from({ length: 1000 }, (_, i) => `tt-${i}`);
    const result = await previewImpact(input);
    expect(result.timetableIds).toEqual(state.ids);
    expect(result.impact.affectedTimetableCount).toBe(1000);
    expect(
      vi.mocked(getPublishedTimetableById).mock.calls.length,
    ).toBeLessThanOrEqual(3);
    expect(result.impact.previewStatus).toBe("partial");
    expect(result.impact.newlySuppressedLectureCount).toBe(21);
  });

  it("uses the exact scope count when returned IDs are truncated", async () => {
    state.ids = ["tt-1"];
    state.totalCount = 1200;
    const { impact, timetableIds } = await previewImpact(input);
    expect(impact).toMatchObject({
      affectedTimetableCount: 1200,
      affectedTimetableCountKnown: true,
      newlySuppressedLectureCount: 7,
      previewStatus: "partial",
    });
    expect(timetableIds).toEqual(["tt-1"]);
  });

  it("never claims exact totals without scope count metadata", async () => {
    state.totalCount = null;
    expect((await previewImpact(input)).impact).toMatchObject({
      affectedTimetableCountKnown: false,
      previewStatus: "partial",
    });
    state.ids = [];
    expect((await previewImpact(input)).impact).toMatchObject({
      affectedTimetableCountKnown: false,
      previewStatus: "unknown",
    });
  });

  it("caps aggregate timetable-days even for centuries without a term end", async () => {
    state.ids = ["tt-1", "tt-2", "tt-3"];
    const result = await previewImpact({ ...input, endsOn: "9999-12-31" });
    expect(
      vi.mocked(resolveScheduleForDate).mock.calls.length,
    ).toBeLessThanOrEqual(62);
    expect(result.impact.evaluatedDayCount).toBe(31);
    expect(result.impact.previewStatus).toBe("partial");
    expect(result.impact.newlySuppressedLectureCount).toBe(31);
    expect(result.impact.affectedTimetableCount).toBe(3);
  });

  it("shares the day budget across timetables rather than resetting per load", async () => {
    state.ids = ["tt-1", "tt-2", "tt-3"];
    const { impact } = await previewImpact({ ...input, endsOn: "2026-10-03" });
    expect(impact).toMatchObject({
      affectedTimetableCount: 3,
      newlySuppressedLectureCount: 31,
      evaluatedDayCount: 31,
      evaluatedTimetableCount: 2,
      previewStatus: "partial",
      previewReason: "bounds",
    });
    expect(vi.mocked(resolveScheduleForDate).mock.calls).toHaveLength(62);
    expect(vi.mocked(getPublishedTimetableById).mock.calls).toHaveLength(2);
  });

  it("returns a lower bound and the full ID count when a later load fails", async () => {
    state.ids = ["tt-1", "tt-2", "tt-3"];
    vi.mocked(getPublishedTimetableById)
      .mockResolvedValueOnce(timetable())
      .mockRejectedValueOnce(new Error("fixture read failed"));
    const { impact, timetableIds } = await createPauseWithImpact(actor, input);
    expect(impact).toMatchObject({
      affectedTimetableCount: 3,
      affectedTimetableCountKnown: true,
      newlySuppressedLectureCount: 7,
      previewStatus: "partial",
      previewReason: "read_failed",
    });
    expect(timetableIds).toEqual(state.ids);
    expect(state.saved).toHaveLength(1);
  });

  it("reports an empty scope as exact without hydrating any timetables", async () => {
    state.ids = [];
    expect((await previewImpact(input)).impact).toMatchObject({
      affectedTimetableCount: 0,
      affectedTimetableCountKnown: true,
      newlySuppressedLectureCount: 0,
      previewStatus: "exact",
    });
    expect(getPublishedTimetableById).not.toHaveBeenCalled();
  });

  it("keeps small previews exact and excludes already suppressed lectures", async () => {
    const value = timetable();
    value.pauses = [
      {
        id: "existing",
        scopeType: "institution",
        stableSessionKey: null,
        startsOn: input.startsOn,
        endsOn: input.startsOn,
        allDay: true,
        startsAt: null,
        endsAt: null,
        reason: "closure",
        label: "Existing",
        active: true,
        createdAt: "2026-09-01T00:00:00Z",
      },
    ];
    vi.mocked(getPublishedTimetableById).mockResolvedValue(value);
    const { impact } = await previewImpact(input);
    expect(impact).toMatchObject({
      affectedTimetableCount: 1,
      newlySuppressedLectureCount: 6,
      previewStatus: "exact",
      evaluatedDayCount: 7,
    });
    expect(state.saved).toEqual([]);
  });

  it.each(["scope", "timetable"])(
    "persists canonical create when the %s read fails",
    async (failure) => {
      state.failScope = failure === "scope";
      state.failTimetable = failure === "timetable";
      const result = await createPauseWithImpact(actor, input);
      expect(state.saved).toHaveLength(1);
      expect(result.pause.id).toBe("saved-pause");
      expect(result.impact.previewStatus).toBe("unknown");
      expect(result.impact.affectedTimetableCountKnown).toBe(
        failure !== "scope",
      );
    },
  );

  it("retains data validation and authorization when preview reads fail", async () => {
    state.failScope = true;
    await expect(
      createPauseWithImpact(actor, { ...input, endsOn: "2020-01-01" }),
    ).rejects.toMatchObject({ code: "INVALID_PAUSE_RANGE" });
    await expect(
      createPauseWithImpact(
        {
          ...actor,
          staff: { ...actor.staff, role: "class_rep" },
          permissions: { ...actor.permissions, canManageAllTimetables: false },
        },
        input,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(state.saved).toEqual([]);
  });

  it("does not swallow canonical write errors", async () => {
    state.failWrite = true;
    await expect(createPauseWithImpact(actor, input)).rejects.toMatchObject({
      code: "DATABASE_UNAVAILABLE",
    });
  });

  it.each(["admin", "class_rep"])(
    "lets %s confirm after preview HTTP failure and surfaces canonical validation",
    async (role) => {
      const create =
        role === "admin"
          ? vi.mocked(createBroadPause)
          : vi.mocked(createTimetablePause);
      create.mockRejectedValueOnce(
        new Error("Canonical validation rejected this pause"),
      );
      if (role === "admin") {
        render(
          createElement(AdminAcademicPauseControl, {
            accessToken: "fixture-token",
            institutions: [
              {
                id: "institution-1",
                name: "Fixture",
                shortName: null,
                slug: "fixture",
                timezone: "Africa/Harare",
                active: true,
                createdAt: "",
                updatedAt: "",
              },
            ],
            programmes: [],
            classGroups: [],
            timetables: [],
          }),
        );
      } else {
        render(
          createElement(ClassRepAcademicPauseAction, {
            accessToken: "fixture-token",
            timetable: timetable(),
            assignment: {
              id: "assignment",
              timetableId: "tt-1",
              publicSlug: "fixture",
              institutionName: "Fixture",
              programmeName: "Fixture",
              classGroupLabel: "1",
              academicPeriodName: "2026",
            },
            onRefresh: async () => {},
            onMessage: vi.fn(),
          }),
        );
      }
      fireEvent.click(
        screen.getByRole("button", {
          name: role === "admin" ? /Add pause/i : /Pause classes/i,
        }),
      );
      fireEvent.change(await screen.findByPlaceholderText("e.g. Sim Break"), {
        target: { value: "Closure" },
      });
      const confirm = screen.getByRole("button", { name: "Confirm pause" });
      expect(confirm).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
      await waitFor(() => expect(confirm).toBeEnabled());
      expect(
        screen.getByText(/Lecture impact unavailable/),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Preview service unavailable"),
      ).toBeInTheDocument();
      fireEvent.click(confirm);
      await waitFor(() => expect(create).toHaveBeenCalled());
      expect(create.mock.calls[0][0]).toBe("fixture-token");
      expect(
        await screen.findByText("Canonical validation rejected this pause"),
      ).toBeInTheDocument();
    },
  );
});
