import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTimetable } from "../src/api/pilotTypes";

const mocks = vi.hoisted(() => ({
  fetchPublicTimetable: vi.fn(),
  createCalendarSubscription: vi.fn(),
  track: vi.fn(),
}));

vi.mock("../src/api/publicTimetable", () => ({
  fetchPublicTimetable: mocks.fetchPublicTimetable,
}));
vi.mock("../src/api/calendarSubscriptions", () => ({
  createCalendarSubscription: mocks.createCalendarSubscription,
}));
vi.mock("../src/analytics", () => ({ track: mocks.track }));

import { PublicTimetableReliability } from "../src/PublicTimetableReliability";

const timetable: PublicTimetable = {
  timetableId: "tt-hit-cs1",
  publicSlug: "hit-cs-1-1-august-2026",
  institution: "Harare Institute of Technology",
  institutionShortName: "HIT",
  institutionTimezone: "Africa/Harare",
  programme: "BTech Computer Science",
  classGroup: "1.1",
  academicPeriod: "August Semester 2026",
  startsOn: "2026-08-10",
  endsOn: "2026-12-10",
  publishedAt: "2026-08-29T08:00:00.000Z",
  versionNumber: 4,
  sessions: [
    {
      stableSessionKey: "ics1102-tue-1400",
      courseCode: "ICS1102",
      courseName: "Operating Systems",
      weekday: 2,
      startTime: "14:00:00",
      endTime: "16:00:00",
      venue: "N205",
      lecturer: "Ms Dube",
      sessionType: "Lecture",
      notes: null,
    },
  ],
};

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0.15];
  constructor(_callback: IntersectionObserverCallback) {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
}

function setIphone() {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 390,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 5,
  });
}

async function reachSuccess() {
  fireEvent.click(
    await screen.findByRole("button", { name: "Subscribe to calendar" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  fireEvent.click(screen.getByRole("button", { name: /Apple Calendar/i }));
  fireEvent.click(await screen.findByRole("button", { name: "Skip for now" }));
  const ready = await screen.findByRole("dialog", { name: "Calendar ready" });
  fireEvent.click(within(ready).getByRole("button", { name: "Continue" }));
  return screen.findByRole("dialog", { name: "You're on track" });
}

beforeEach(() => {
  mocks.fetchPublicTimetable.mockReset().mockResolvedValue(timetable);
  mocks.createCalendarSubscription.mockReset().mockResolvedValue({
    subscriptionId: "sub-private",
    provider: "apple_subscription",
    calendarName: "Class 1.1 · CalenderZW",
    feedUrl: "https://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleDeepLinkUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleSubscribeUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    downloadUrl:
      "https://calender.aido.co.zw/calendar/download/sub-private.ics",
    expiresAt: null,
    contact: { saved: false },
    warnings: [],
  });
  mocks.track.mockReset();
  setIphone();
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: vi.fn(async () => undefined),
  });
  window.history.replaceState({}, "", `/t/${timetable.publicSlug}`);
});

describe("DR-47 class viral loop", () => {
  it("attributes shared-link acquisition through onboarding and shares only a new public class URL", async () => {
    window.history.replaceState(
      {},
      "",
      `/t/${timetable.publicSlug}?src=class_share`,
    );
    const nativeShare = window.navigator.share as ReturnType<typeof vi.fn>;
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    await screen.findByRole("heading", { name: "BTech Computer Science" });
    expect(mocks.track).toHaveBeenCalledWith("shared_link_opened", {
      publicSlug: timetable.publicSlug,
      source: "class_share",
    });

    const success = await reachSuccess();
    expect(
      within(success).getByText("Help your classmates stay on track too."),
    ).toBeInTheDocument();
    expect(
      within(success).getByText(/calendar setup is already complete/i),
    ).toBeInTheDocument();
    expect(mocks.track).toHaveBeenCalledWith(
      "shared_link_onboarding_started",
      expect.objectContaining({ source: "class_share" }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "shared_link_onboarding_completed",
      expect.objectContaining({ source: "class_share" }),
    );
    expect(mocks.track).toHaveBeenCalledWith(
      "onboarding_completed",
      expect.objectContaining({ publicSlug: timetable.publicSlug }),
    );

    fireEvent.click(
      within(success).getByRole("button", { name: "Share to class group" }),
    );
    await waitFor(() => expect(nativeShare).toHaveBeenCalledTimes(1));
    const payload = nativeShare.mock.calls[0][0] as {
      text: string;
      url: string;
    };
    expect(payload.url).toBe(
      `http://localhost:3000/t/${timetable.publicSlug}?src=onboarding_success`,
    );
    expect(payload.text).toContain("see tomorrow's classes");
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(mocks.track).toHaveBeenCalledWith(
      "timetable_shared",
      expect.objectContaining({
        method: "web-share",
        source: "onboarding_success",
      }),
    );
  });

  it("falls back to a WhatsApp-ready class message rather than copying a private feed", async () => {
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: undefined,
    });
    const clipboard = window.navigator.clipboard.writeText as ReturnType<
      typeof vi.fn
    >;
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Share with classmates" }),
    );
    await waitFor(() => expect(clipboard).toHaveBeenCalledTimes(1));
    const copied = String(clipboard.mock.calls[0][0]);
    expect(copied).toContain("Class 1.1 timetable is live on CalenderZW");
    expect(copied).toContain(`?src=class_share`);
    expect(copied).not.toContain("private-token");
    expect(mocks.track).toHaveBeenCalledWith(
      "timetable_shared",
      expect.objectContaining({
        method: "copy-message",
        source: "class_share",
      }),
    );
  });

  it("ignores untrusted attribution values", async () => {
    window.history.replaceState(
      {},
      "",
      `/t/${timetable.publicSlug}?src=subscriber-private-identity`,
    );
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("heading", { name: "BTech Computer Science" });
    expect(mocks.track).not.toHaveBeenCalledWith(
      "shared_link_opened",
      expect.anything(),
    );
  });
});
