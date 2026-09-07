import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRecurringClassUpdate,
  editRecurringClassUpdate,
} from "../src/api/correctionMutations";

const mutationKey = "11111111-1111-4111-8111-111111111111";

function correctionResponse(outcome = "created") {
  return {
    correction: {
      id: "correction-1",
      stableSessionKey: null,
      action: "add",
      sourceMayReplace: true,
      pinned: false,
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
      mutationKey,
      semanticFingerprint: "fingerprint-1",
      revision: 1,
      supersedesId: null,
      replacedById: null,
      revokedAt: null,
      supersededAt: null,
      createdAt: "2026-09-07T14:00:00.000Z",
      updatedAt: "2026-09-07T14:00:00.000Z",
    },
    mutationOutcome: outcome,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DR-53 correction mutation client", () => {
  it("reuses the caller's idempotency key across a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(correctionResponse("created")), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(correctionResponse("replayed")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      action: "add" as const,
      sourceMayReplace: true,
      courseCode: "ICS1103",
      courseName: "Fundamental of Digital Electronics",
      weekday: 2,
      startTime: "08:00",
      endTime: "10:00",
      venue: "N110",
      reason: "Missing from master timetable",
    };

    await createRecurringClassUpdate("token", "tt-1", mutationKey, input);
    await createRecurringClassUpdate("token", "tt-1", mutationKey, input);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers["Idempotency-Key"]).toBe(mutationKey);
      expect(options.headers.Authorization).toBe("Bearer token");
    }
  });

  it("sends optimistic revision evidence and a fresh edit mutation key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(correctionResponse("updated")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await editRecurringClassUpdate(
      "token",
      "tt-1",
      "correction-1",
      mutationKey,
      "2026-09-07T14:00:00.000Z",
      {
        action: "add",
        sourceMayReplace: true,
        courseCode: "ICS1103",
        courseName: "Fundamental of Digital Electronics",
        weekday: 2,
        startTime: "08:00",
        endTime: "10:00",
        venue: "N110",
        reason: "Confirmed by lecturer",
      },
    );

    const [, options] = fetchMock.mock.calls[0];
    expect(options.method).toBe("PATCH");
    expect(options.headers["Idempotency-Key"]).toBe(mutationKey);
    expect(JSON.parse(options.body)).toMatchObject({
      expectedUpdatedAt: "2026-09-07T14:00:00.000Z",
      courseCode: "ICS1103",
      weekday: 2,
    });
  });

  it("treats exact semantic duplicate responses as success-like results", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(correctionResponse("already_exists")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRecurringClassUpdate(
      "token",
      "tt-1",
      mutationKey,
      {
        action: "add",
        sourceMayReplace: true,
        courseCode: "ICS1103",
        courseName: "Fundamental of Digital Electronics",
        weekday: 2,
        startTime: "08:00",
        endTime: "10:00",
        venue: "N110",
        reason: "Same real class",
      },
    );

    expect(result.mutationOutcome).toBe("already_exists");
    expect(result.correction.courseCode).toBe("ICS1103");
  });
});
