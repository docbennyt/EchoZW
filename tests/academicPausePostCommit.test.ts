// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import type { StaffAuthContext } from "../server/supabase/auth";

const state = vi.hoisted(() => ({ committed: false }));
vi.mock("../server/academicPauseRepository.js", () => ({
  deactivateAcademicPause: vi.fn(async () => {
    state.committed = true;
    return { id: "pause", active: false, scopeType: "institution" };
  }),
  listPublishedTimetableIdsForPauseScope: vi.fn(async () => {
    throw new Error("scope read unavailable after commit");
  }),
}));
import { deactivatePauseWithTimetables } from "../server/academicPauseCore";

describe("academic pause post-commit recovery", () => {
  it("returns the committed resumption with unknown scope for deferred recovery", async () => {
    const result = await deactivatePauseWithTimetables({
      actor: {} as StaffAuthContext,
      pauseId: "pause",
    });
    expect(state.committed).toBe(true);
    expect(result).toMatchObject({
      pause: { id: "pause", active: false },
      timetableIds: null,
    });
  });
});
