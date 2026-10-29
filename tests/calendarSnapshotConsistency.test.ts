// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clock: vi.fn(),
  content: vi.fn(),
  serialize: vi.fn(),
}));
vi.mock("../server/calendarRevisionRepository.js", () => ({
  getCalendarRevision: mocks.clock,
}));
vi.mock("../server/pilotRepository.js", async (original) => ({
  ...(await original<typeof import("../server/pilotRepository.js")>()),
  getPublishedTimetableById: mocks.content,
}));
vi.mock("../server/publishedCalendar.js", () => ({
  generatePublishedTimetableIcs: mocks.serialize,
}));
import { buildRevisionAwareCalendar } from "../server/pilotCalendarCore";

const first = {
  sequence: 10,
  updatedAt: "2026-10-25T10:00:00.000Z",
  publishedVersionId: "version-one",
};
const next = {
  sequence: 11,
  updatedAt: "2026-10-25T10:00:01.000Z",
  publishedVersionId: "version-one",
};
const env = Object.freeze({ SUPABASE_URL: "https://snapshot.invalid" });
const input = {
  timetableId: "fixture",
  reminders: [30],
  publicOrigin: "https://fixture.invalid",
  env,
};
const content = (marker: string) => ({
  publishedAt: first.updatedAt,
  publicSlug: marker,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.clock.mockResolvedValue(first);
  mocks.content.mockResolvedValue(content("stable"));
  mocks.serialize.mockImplementation(
    ({ timetable }) => `${timetable.publicSlug}:${timetable.versionNumber}`,
  );
});

describe("revision-consistent calendar content", () => {
  it("brackets content reads with the same durable clock before serialization", async () => {
    expect(await buildRevisionAwareCalendar(input)).toEqual({
      ics: "stable:10",
      revision: first,
    });
    expect(mocks.clock).toHaveBeenCalledTimes(2);
    expect(mocks.clock).toHaveBeenNthCalledWith(1, "fixture", env);
    expect(mocks.clock).toHaveBeenNthCalledWith(2, "fixture", env);
    expect(mocks.clock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.content.mock.invocationCallOrder[0],
    );
    expect(mocks.content.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.clock.mock.invocationCallOrder[1],
    );
    expect(mocks.clock.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.serialize.mock.invocationCallOrder[0],
    );
  });

  it("does not stamp old content with a newer pause revision", async () => {
    let current = first;
    mocks.clock.mockImplementation(async () => current);
    mocks.content
      .mockImplementationOnce(async () => {
        current = next;
        return content("before-pause");
      })
      .mockResolvedValue(content("after-pause"));
    expect(await buildRevisionAwareCalendar(input)).toEqual({
      ics: "after-pause:11",
      revision: next,
    });
    expect(mocks.content).toHaveBeenCalledTimes(2);
    expect(mocks.clock).toHaveBeenCalledTimes(4);
    expect(mocks.serialize).toHaveBeenCalledOnce();
  });

  it("also retries a changed timestamp rather than trusting a matching number alone", async () => {
    const changed = { ...first, updatedAt: next.updatedAt };
    mocks.clock.mockResolvedValueOnce(first).mockResolvedValue(changed);
    mocks.content
      .mockResolvedValueOnce(content("old"))
      .mockResolvedValue(content("fresh"));
    expect((await buildRevisionAwareCalendar(input)).ics).toBe("fresh:10");
    expect(mocks.content).toHaveBeenCalledTimes(2);
  });

  it("retries a publication identity change before accepting content", async () => {
    const changed = { ...first, publishedVersionId: "version-two" };
    mocks.clock.mockResolvedValueOnce(first).mockResolvedValue(changed);
    mocks.content
      .mockResolvedValueOnce(content("old-publication"))
      .mockResolvedValue(content("new-publication"));
    expect(await buildRevisionAwareCalendar(input)).toEqual({
      ics: "new-publication:10",
      revision: changed,
    });
    expect(mocks.content).toHaveBeenCalledTimes(2);
    expect(mocks.serialize).toHaveBeenCalledOnce();
  });

  it("fails closed after two unstable attempts instead of consuming a revision", async () => {
    let revision = 10;
    mocks.clock.mockImplementation(async () => ({
      ...first,
      sequence: revision++,
    }));
    await expect(buildRevisionAwareCalendar(input)).rejects.toMatchObject({
      code: "CALENDAR_REVISION_UNSTABLE",
      status: 503,
    });
    expect(mocks.clock).toHaveBeenCalledTimes(4);
    expect(mocks.content).toHaveBeenCalledTimes(2);
    expect(mocks.serialize).not.toHaveBeenCalled();
  });

  it("does not read content when revision authority is unavailable", async () => {
    mocks.clock.mockRejectedValue(new Error("revision unavailable"));
    await expect(buildRevisionAwareCalendar(input)).rejects.toThrow(
      "revision unavailable",
    );
    expect(mocks.content).not.toHaveBeenCalled();
    expect(mocks.serialize).not.toHaveBeenCalled();
  });

  it("retains the unpublished timetable guard", async () => {
    mocks.content.mockResolvedValue({ ...content("draft"), publishedAt: null });
    await expect(buildRevisionAwareCalendar(input)).rejects.toMatchObject({
      code: "TIMETABLE_NOT_PUBLISHED",
      status: 404,
    });
    expect(mocks.serialize).not.toHaveBeenCalled();
  });
});
