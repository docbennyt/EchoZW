import { describe, expect, it, vi } from "vitest";
import { createReadyDraftsSequentially } from "../src/staticTimetableDraftWorkflow";

describe("static timetable multi-target draft workflow", () => {
  it("refreshes after partial success and retries only unfinished targets", async () => {
    const created = new Set<string>();
    const refreshReview = vi.fn(async () => ({
      targets: [
        {
          id: "target-a",
          createdDraft: created.has("target-a")
            ? { draftVersionId: "v-a" }
            : null,
        },
        {
          id: "target-b",
          createdDraft: null,
        },
      ],
    }));
    const createDraft = vi.fn(async (target: { id: string }) => {
      if (target.id === "target-b") {
        throw new Error("Course code is required.");
      }
      created.add(target.id);
    });

    const first = await createReadyDraftsSequentially({
      targets: [
        { id: "target-a", titleRaw: "Part 1 Semester 1", createdDraft: null },
        { id: "target-b", titleRaw: "Part 2 Semester 1", createdDraft: null },
      ],
      isReady: () => true,
      createDraft,
      refreshReview,
    });

    expect(first.created).toBe(1);
    expect(first.error?.message).toBe("Course code is required.");
    expect(first.message).toBe(
      "1 draft created. Part 2 Semester 1 could not be created: Course code is required.",
    );
    expect(first.refreshedReview?.targets[0]?.createdDraft).toEqual({
      draftVersionId: "v-a",
    });

    createDraft.mockClear();
    refreshReview.mockClear();

    await createReadyDraftsSequentially({
      targets: first.refreshedReview?.targets ?? [],
      isReady: () => true,
      createDraft,
      refreshReview,
    });

    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ id: "target-b" }),
    );
  });
});
