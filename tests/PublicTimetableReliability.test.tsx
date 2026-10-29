import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("../src/PersonalTimetablePreview", () => ({
  PersonalTimetablePreview: () => (
    <div data-testid="visual-preview">Preview</div>
  ),
}));
vi.mock("../src/pwa/ChangeAlertsControl", () => ({
  ChangeAlertsControl: () => <div data-testid="change-alerts">Alerts</div>,
}));
vi.mock("../src/GoogleCalendarDisconnectEntry", () => ({
  GoogleCalendarDisconnectEntry: () => null,
}));

import { PublicTimetableReliability } from "../src/PublicTimetableReliability";

const timetable: PublicTimetable = {
  timetableId: "tt-hit-cs1",
  publicSlug: "hit-ics-1-1-august-semester-2026",
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
      stableSessionKey: "hit1101-mon-0800",
      courseCode: "HIT1101",
      courseName: "Technopreneurship I",
      weekday: 1,
      startTime: "08:00:00",
      endTime: "10:00:00",
      venue: "Engineering Hall",
      lecturer: "TDC",
      sessionType: "Lecture",
      notes: null,
    },
  ],
};

let observerCallback: IntersectionObserverCallback | null = null;
class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "0px";
  readonly scrollMargin = "0px";
  readonly thresholds = [0.15];
  constructor(callback: IntersectionObserverCallback) {
    observerCallback = callback;
  }
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
}

function setPlatform(userAgent: string, width = 390, maxTouchPoints = 0) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: maxTouchPoints,
  });
}

function enableGoogle() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/calendar/google/status")) {
        return new Response(JSON.stringify({ enabled: true }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    }),
  );
}

async function openProviderStep(reminder = "Prepared") {
  fireEvent.click(
    await screen.findByRole("button", { name: "Add to Calendar" }),
  );
  const reminderDialog = screen.getByRole("dialog", {
    name: "Choose your reminders",
  });
  fireEvent.click(
    within(reminderDialog).getByRole("radio", {
      name: new RegExp(reminder, "i"),
    }),
  );
  return screen.findByRole("dialog", { name: "Choose calendar destination" });
}

beforeEach(() => {
  mocks.fetchPublicTimetable.mockReset();
  mocks.createCalendarSubscription.mockReset();
  mocks.track.mockReset();
  mocks.fetchPublicTimetable.mockResolvedValue(timetable);
  mocks.createCalendarSubscription.mockResolvedValue({
    subscriptionId: "sub-42",
    provider: "apple_subscription",
    calendarName: "Class 1.1 · CalenderZW",
    feedUrl: "https://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleDeepLinkUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    appleSubscribeUrl:
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    downloadUrl: "https://calender.aido.co.zw/calendar/download/sub-42.ics",
    expiresAt: null,
    contact: { saved: false },
    warnings: [],
  });
  setPlatform(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) Safari/604.1",
    390,
    5,
  );
  observerCallback = null;
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: undefined,
  });
});

describe("DR-64 student Add-to-Calendar conversion", () => {
  afterEach(() => vi.useRealTimers());
  it("explains the current SWOT pause without presenting the regular grid as this week's classes", async () => {
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      endsOn: "2026-11-01",
      pauses: [
        {
          id: "pause-1",
          scopeType: "institution",
          stableSessionKey: null,
          startsOn: "2026-10-26",
          endsOn: "2026-11-30",
          allDay: true,
          startsAt: null,
          endsAt: null,
          reason: "swot_week",
          label: "SWOT week",
          active: true,
          createdAt: "2026-10-26T00:00:00Z",
        },
      ],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const notice = await screen.findByRole("status", {
      name: "Current class pauses",
    });
    expect(
      within(notice).getByRole("heading", { name: "Classes paused" }),
    ).toBeInTheDocument();
    expect(within(notice).getByText("SWOT week")).toBeInTheDocument();
    expect(within(notice).getByText("26 October 2026")).toBeInTheDocument();
    expect(within(notice).getByText("30 November 2026")).toBeInTheDocument();
    expect(screen.getByText("Regular weekly schedule")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pause periods above override these regular class times.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Current published week")).toBeNull();
    expect(screen.queryByText(/No more published sessions/)).toBeNull();
  });
  it("does not describe a session-only pause as a whole-class closure", async () => {
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      pauses: [
        {
          id: "pause-1",
          scopeType: "session",
          stableSessionKey: "hit1101-mon-0800",
          startsOn: "2026-10-26",
          endsOn: "2026-11-30",
          allDay: true,
          startsAt: null,
          endsAt: null,
          reason: "other",
          label: "HIT1101 teaching pause",
          active: true,
          createdAt: "2026-10-26T00:00:00Z",
        },
      ],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const notice = await screen.findByRole("status", {
      name: "Current class pauses",
    });
    expect(
      within(notice).getByRole("heading", { name: "Some classes paused" }),
    ).toBeInTheDocument();
    expect(
      within(notice).queryByRole("heading", {
        name: "Classes paused",
      }),
    ).toBeNull();
  });
  it("does not show disabled or ended pauses as current closures", async () => {
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      pauses: [
        {
          id: "ended",
          scopeType: "institution",
          startsOn: "2026-10-26",
          endsOn: "2026-11-30",
          allDay: true,
          active: true,
        },
        {
          id: "disabled",
          scopeType: "institution",
          startsOn: "2026-10-26",
          endsOn: "2026-12-10",
          allDay: true,
          active: false,
        },
      ],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });
    expect(
      screen.queryByRole("status", { name: "Current class pauses" }),
    ).toBeNull();
  });
  it("shows dated examinations separately from the regular weekly timetable during the lecture pause", async () => {
    vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      pauses: [
        {
          id: "lecture-pause",
          scopeType: "institution",
          stableSessionKey: null,
          startsOn: "2026-10-26",
          endsOn: "2026-11-30",
          allDay: true,
          startsAt: null,
          endsAt: null,
          reason: "other",
          label: "Lectures paused during examinations",
          active: true,
          createdAt: "2026-10-26T00:00:00Z",
        },
      ],
      exceptions: [
        {
          id: "published-exam-root",
          stableSessionKey: null,
          exceptionDate: "2026-11-02",
          exceptionType: "extra",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: "HIT4101",
          courseName: "Software Engineering",
          startTime: "09:00:00",
          endTime: "12:00:00",
          venue: "Exam Hall",
          lecturer: null,
          sessionType: "Examination",
          notes: null,
          reason: "Approved examination timetable",
          provenance: "Reviewed institutional source",
          active: true,
          createdAt: "2026-10-29T08:00:00Z",
        },
      ],
    });

    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    const exams = await screen.findByRole("region", {
      name: "Published examinations",
    });
    expect(within(exams).getByText("Software Engineering")).toBeInTheDocument();
    expect(within(exams).getByText("HIT4101")).toBeInTheDocument();
    expect(within(exams).getByText("2 November 2026")).toBeInTheDocument();
    expect(within(exams).getByText("09:00–12:00")).toBeInTheDocument();
    expect(within(exams).getByText("Exam Hall")).toBeInTheDocument();

    const weekly = screen.getByRole("region", {
      name: "Regular weekly schedule",
    });
    expect(within(weekly).queryByText("HIT4101")).toBeNull();
    expect(within(weekly).getAllByText("HIT1101")).not.toHaveLength(0);
    expect(screen.getByText("Next exam")).toBeInTheDocument();
  });
  it("keeps a dated non-exam event visible outside the recurring weekly grid", async () => {
    vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      exceptions: [
        {
          id: "dated-workshop",
          stableSessionKey: null,
          exceptionDate: "2026-11-03",
          exceptionType: "extra",
          replacementStartsAt: null,
          replacementEndsAt: null,
          courseCode: "HIT4200",
          courseName: "Research workshop",
          startTime: "13:00:00",
          endTime: "14:00:00",
          venue: "Workshop room",
          lecturer: null,
          sessionType: "Workshop",
          notes: null,
          reason: "Published extra",
          provenance: "Staging fixture",
          active: true,
          createdAt: "2026-10-29T08:00:00Z",
        },
      ],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const dated = await screen.findByRole("region", {
      name: "Other published events",
    });
    expect(within(dated).getByText("Research workshop")).toBeInTheDocument();
    expect(within(dated).getByText("3 November 2026")).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Regular weekly schedule" }),
      ).queryByText("HIT4200"),
    ).toBeNull();
  });
  it.each(["Lecture", "Workshop"])(
    "displays moved %s times in the institution timezone",
    async (sessionType) => {
      vi.setSystemTime(new Date("2026-10-29T10:00:00Z"));
      mocks.fetchPublicTimetable.mockResolvedValue({
        ...timetable,
        sessions: [{ ...timetable.sessions[0], sessionType }],
        exceptions: [
          {
            id: "moved-event",
            stableSessionKey: timetable.sessions[0].stableSessionKey,
            exceptionDate: "2026-11-02",
            exceptionType: "moved",
            replacementStartsAt: "2026-11-02T07:00:00Z",
            replacementEndsAt: "2026-11-02T10:00:00Z",
            active: true,
            createdAt: "2026-10-29T08:00:00Z",
          },
        ],
      });
      render(<PublicTimetableReliability slug={timetable.publicSlug} />);
      const region = await screen.findByRole("region", {
        name: "Other published events",
      });
      expect(within(region).getByText("09:00–12:00")).toHaveAttribute(
        "datetime",
        "2026-11-02T07:00:00.000Z",
      );
    },
  );
  it.each([
    ["08:00:00", "09:00:00", false],
    ["09:00:00", "11:00:00", true],
    ["11:00:00", "12:00:00", false],
  ] as const)(
    "shows timed pauses only within their active window (%s–%s)",
    async (start, end, visible) => {
      vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
      mocks.fetchPublicTimetable.mockResolvedValue({
        ...timetable,
        pauses: [
          {
            id: "timed",
            scopeType: "institution",
            stableSessionKey: null,
            startsOn: "2026-10-27",
            endsOn: "2026-10-27",
            allDay: false,
            startsAt: `2026-10-27T${start}Z`,
            endsAt: `2026-10-27T${end}Z`,
            reason: "other",
            label: "Campus closure",
            active: true,
            createdAt: "2026-10-26T00:00:00Z",
          },
        ],
      });
      render(<PublicTimetableReliability slug={timetable.publicSlug} />);
      await screen.findByRole("heading", {
        level: 1,
        name: "BTech Computer Science",
      });
      expect(
        Boolean(screen.queryByRole("status", { name: "Current class pauses" })),
      ).toBe(visible);
    },
  );
  it("keeps the mobile conversion hierarchy direct and removes standalone publication/timezone clutter", async () => {
    const { container } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );
    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });
    expect(screen.getByText("Part 1.1")).toBeInTheDocument();
    expect(screen.getByText(/Updated/i)).toBeInTheDocument();
    expect(screen.getByText("Next class")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to Calendar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Share with classmates" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Published by CalenderZW/i)).toBeNull();
    expect(container.querySelector(".pt-timezone-note")).toBeNull();
  });
  it("clears an ended pause when a student returns to an open timetable tab", async () => {
    vi.setSystemTime(new Date("2026-10-27T10:00:00Z"));
    mocks.fetchPublicTimetable.mockResolvedValue({
      ...timetable,
      pauses: [
        {
          id: "pause-1",
          scopeType: "institution",
          stableSessionKey: null,
          startsOn: "2026-10-26",
          endsOn: "2026-11-30",
          allDay: true,
          startsAt: null,
          endsAt: null,
          reason: "swot_week",
          label: "SWOT week",
          active: true,
          createdAt: "2026-10-26T00:00:00Z",
        },
      ],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("status", { name: "Current class pauses" });
    vi.setSystemTime(new Date("2026-12-01T10:00:00Z"));
    fireEvent.focus(window);
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Current class pauses" }),
      ).toBeNull(),
    );
  });

  it("fails closed on optional public surfaces unless durable settings enable them", async () => {
    const { rerender } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );
    await screen.findByRole("button", { name: "Add to Calendar" });
    expect(screen.queryByTestId("visual-preview")).toBeNull();
    expect(screen.queryByTestId("change-alerts")).toBeNull();

    mocks.fetchPublicTimetable.mockResolvedValueOnce({
      ...timetable,
      publicDisplay: { showVisualPreview: true, showChangeAlerts: true },
    });
    rerender(<PublicTimetableReliability slug="settings-enabled" />);
    expect(await screen.findByTestId("visual-preview")).toBeInTheDocument();
    expect(screen.getByTestId("change-alerts")).toBeInTheDocument();
  });

  it("does not auto-advance the visually selected default reminder merely by opening", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to Calendar" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Choose your reminders",
    });
    expect(
      within(dialog).getByRole("radio", { name: /On time/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.queryByRole("dialog", { name: "Choose calendar destination" }),
    ).toBeNull();
  });

  it("advances immediately on a fixed reminder tap and emits reminder/step analytics once", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await openProviderStep("Prepared");
    const reminderCalls = mocks.track.mock.calls.filter(
      ([name]) => name === "reminder_selected",
    );
    const completedCalls = mocks.track.mock.calls.filter(
      ([name, payload]) =>
        name === "onboarding_step_completed" && payload?.step === "reminders",
    );
    expect(reminderCalls).toHaveLength(1);
    expect(completedCalls).toHaveLength(1);
  });

  it("requires explicit save for a custom reminder and preserves it through Back", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Add to Calendar" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: /Custom/i }));
    expect(
      screen.getByRole("dialog", { name: "Choose your reminders" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Hours before class"), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText("Minutes before class"), {
      target: { value: "15" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save custom reminder" }),
    );
    const providerDialog = await screen.findByRole("dialog", {
      name: "Choose calendar destination",
    });
    fireEvent.click(
      within(providerDialog).getByRole("button", { name: "Back" }),
    );
    const reminderDialog = screen.getByRole("dialog", {
      name: "Choose your reminders",
    });
    expect(
      within(reminderDialog).getByRole("radio", { name: /Custom/i }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByLabelText("Hours before class")).toHaveValue("2");
    expect(screen.getByLabelText("Minutes before class")).toHaveValue("15");
  });

  it("orders Apple → Google → Advanced on iPhone and Google → Apple → Advanced on Windows", async () => {
    enableGoogle();
    const { unmount } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );
    const iphoneDialog = await openProviderStep();
    await waitFor(() =>
      expect(
        within(iphoneDialog).getByText("Continue with Google"),
      ).toBeInTheDocument(),
    );
    const appleIphone = within(iphoneDialog).getByText("Add to Apple Calendar");
    const googleIphone = within(iphoneDialog).getByText("Continue with Google");
    const advancedIphone = within(iphoneDialog).getByText("Advanced options");
    expect(
      appleIphone.compareDocumentPosition(googleIphone) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      googleIphone.compareDocumentPosition(advancedIphone) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    unmount();

    setPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 1440);
    enableGoogle();
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const windowsDialog = await openProviderStep();
    await waitFor(() =>
      expect(
        within(windowsDialog).getByText("Continue with Google"),
      ).toBeInTheDocument(),
    );
    const googleWindows = within(windowsDialog).getByText(
      "Continue with Google",
    );
    const appleWindows = within(windowsDialog).getByText(
      "Add to Apple Calendar",
    );
    const advancedWindows = within(windowsDialog).getByText("Advanced options");
    expect(
      googleWindows.compareDocumentPosition(appleWindows) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      appleWindows.compareDocumentPosition(advancedWindows) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("keeps URL and ICS truthful fallbacks collapsed under Advanced and never asks for phone/contact", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const dialog = await openProviderStep();
    expect(within(dialog).queryByLabelText(/Phone number/i)).toBeNull();
    expect(within(dialog).queryByText(/optional contact/i)).toBeNull();
    const details = within(dialog)
      .getByText("Advanced options")
      .closest("details");
    expect(details).not.toHaveAttribute("open");
    expect(
      within(dialog).getByRole("button", { name: /Copy subscription URL/i }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /Download one-time ICS/i }),
    ).toBeInTheDocument();
  });

  it("uses a synchronous provider lock so rapid repeat taps create one subscription", async () => {
    let resolveSubscription: ((value: unknown) => void) | null = null;
    mocks.createCalendarSubscription.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSubscription = resolve;
        }),
    );
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const dialog = await openProviderStep();
    const apple = within(dialog).getByRole("button", {
      name: /Add to Apple Calendar/i,
    });
    fireEvent.click(apple);
    fireEvent.click(apple);
    expect(mocks.createCalendarSubscription).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveSubscription?.({
        subscriptionId: "sub-lock",
        provider: "apple_subscription",
        calendarName: "Class 1.1 · CalenderZW",
        feedUrl: "https://calender.aido.co.zw/calendar/feed/private-token.ics",
        appleDeepLinkUrl:
          "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
        warnings: [],
        contact: { saved: false },
      });
    });
  });

  it("treats the durable provider result as completion without a cosmetic final Continue", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const dialog = await openProviderStep();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Add to Apple Calendar/i }),
    );
    const result = await screen.findByRole("dialog", {
      name: "Calendar ready",
    });
    expect(
      within(result).queryByRole("button", { name: "Continue" }),
    ).toBeNull();
    expect(
      within(result).getByRole("button", { name: "Done" }),
    ).toBeInTheDocument();
    expect(
      mocks.track.mock.calls.filter(
        ([name]) => name === "onboarding_completed",
      ),
    ).toHaveLength(1);
  });

  it("restores focus after Escape and keeps the sticky CTA out of the open sheet", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    const primary = await screen.findByRole("button", {
      name: "Add to Calendar",
    });
    primary.focus();
    act(() => {
      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(
      screen.getAllByRole("button", { name: "Add to Calendar" }).length,
    ).toBeGreaterThanOrEqual(1);
    fireEvent.click(primary);
    expect(
      screen.getAllByRole("button", { name: "Add to Calendar" }),
    ).toHaveLength(1);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(primary).toHaveFocus());
  });
});
