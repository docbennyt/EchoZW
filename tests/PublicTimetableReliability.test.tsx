import {
  act,
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
  it("keeps the mobile conversion hierarchy direct and removes standalone publication/timezone clutter", async () => {
    const { container } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );
    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });
    expect(screen.getByText("Class 1.1")).toBeInTheDocument();
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
