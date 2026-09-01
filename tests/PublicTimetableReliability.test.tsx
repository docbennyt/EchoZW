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

import {
  courseToneClass,
  PublicTimetableReliability,
} from "../src/PublicTimetableReliability";

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
    {
      stableSessionKey: "ics1101-tue-1015",
      courseCode: "ICS1101",
      courseName: "Principles of Programming Languages",
      weekday: 2,
      startTime: "10:15:00",
      endTime: "12:15:00",
      venue: "N205",
      lecturer: "ABC",
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

function setIphoneViewport() {
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
  setIphoneViewport();
  observerCallback = null;
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: undefined,
  });
});

describe("public timetable reliability UX", () => {
  it("uses the site-wide chrome and keeps the approved footer attribution", async () => {
    const { container } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );

    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });
    expect(
      container.querySelector('[data-component="GlobalHeader"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-component="GlobalFooter"]'),
    ).not.toBeNull();
    expect(screen.getByRole("link", { name: "Dr BennyT" })).toHaveAttribute(
      "href",
      "https://docbennyt.github.io",
    );
    expect(screen.queryByText(/CalenderZW · operated by aiDo/i)).toBeNull();
  });

  it("renders a single useful timetable hero before calendar delivery without a blank success panel", async () => {
    const { container } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "BTech Computer Science",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Harare Institute of Technology"),
    ).toBeInTheDocument();
    expect(screen.getByText("Class 1.1")).toBeInTheDocument();
    expect(
      screen.getByText(/Times shown in Harare time \(CAT\)/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Subscribe to calendar" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Share with classmates" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".pt-success-card")).toBeNull();
    expect(
      container.querySelector(".pt-hero")?.classList.contains("has-result"),
    ).toBe(false);
  });

  it("renders a semantic desktop timetable matrix from the same published events", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });

    const table = screen.getByRole("table", {
      name: /BTech Computer Science Class 1\.1 weekly timetable/i,
    });
    expect(
      within(table).getByRole("columnheader", { name: "Monday" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: "Tuesday" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("rowheader", { name: "08:00" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("rowheader", { name: "10:15" }),
    ).toBeInTheDocument();
    expect(within(table).getByText("HIT1101")).toBeInTheDocument();
    expect(within(table).getByText("ICS1101")).toBeInTheDocument();
  });

  it("uses deterministic course tones so repeated sessions remain visually stable", () => {
    expect(courseToneClass("HIT1101")).toBe(courseToneClass("hit1101"));
    expect(courseToneClass("ICS1101")).toMatch(/^tone-/);
  });

  it("uses a focused in-modal reminder step before provider selection", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    const primary = await screen.findByRole("button", {
      name: "Subscribe to calendar",
    });
    primary.focus();
    fireEvent.click(primary);

    const dialog = screen.getByRole("dialog", {
      name: "Choose your reminders",
    });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(
      within(dialog).getByRole("button", { name: "Continue" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /Apple Calendar/i }),
    ).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("dialog", {
        name: "Choose calendar destination",
      }),
    ).toBeInTheDocument();
  });

  it("offers Apple first on iPhone, shows subscription URL and one-time ICS, and has accessible dialog dismissal", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    const primary = await screen.findByRole("button", {
      name: "Subscribe to calendar",
    });
    primary.focus();
    fireEvent.click(primary);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const dialog = screen.getByRole("dialog", {
      name: "Choose calendar destination",
    });
    const apple = within(dialog).getByRole("button", {
      name: /Apple Calendar/i,
    });
    const url = within(dialog).getByRole("button", {
      name: /Google\/other subscription URL/i,
    });
    const oneTime = within(dialog).getByRole("button", {
      name: /Download one-time \.ics/i,
    });
    expect(
      apple.compareDocumentPosition(url) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      url.compareDocumentPosition(oneTime) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      within(dialog).queryByText(/Google Calendar direct sync/i),
    ).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(primary).toHaveFocus());
  });

  it("creates a canonical HTTPS Apple feed after skipped contact and keeps result in the modal", async () => {
    const { container } = render(
      <PublicTimetableReliability slug={timetable.publicSlug} />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Subscribe to calendar" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: /Apple Calendar/i }));
    expect(
      await screen.findByRole("dialog", { name: "Add optional contact" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Phone number")).toHaveAttribute(
      "autocomplete",
      "tel",
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));

    await waitFor(() =>
      expect(mocks.createCalendarSubscription).toHaveBeenCalledTimes(1),
    );
    expect(mocks.createCalendarSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        timetableId: "tt-hit-cs1",
        provider: "apple_subscription",
        reminderPreset: "on_time",
        timezone: "Africa/Harare",
      }),
    );
    expect(
      await screen.findByText(/private HTTPS subscription is ready/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open Apple Calendar/i }),
    ).toHaveAttribute(
      "href",
      "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
    );
    expect(
      screen.getByRole("button", { name: /Copy subscription URL/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: "Calendar ready" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".pt-success-card")).toBeNull();
  });

  it("sends optional contact only after explicit consent and never tracks the phone", async () => {
    mocks.createCalendarSubscription.mockResolvedValueOnce({
      subscriptionId: "sub-contact",
      provider: "webcal_subscription",
      calendarName: "Class 1.1 · CalenderZW",
      feedUrl: "https://calender.aido.co.zw/calendar/feed/private-token.ics",
      downloadUrl:
        "https://calender.aido.co.zw/calendar/download/sub-contact.ics",
      expiresAt: null,
      contact: { saved: true, countryCode: "ZW" },
      warnings: [],
    });
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Subscribe to calendar" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Google\/other subscription URL/i }),
    );
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "077 123 4567" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save contact & continue" }),
    );

    await waitFor(() =>
      expect(mocks.createCalendarSubscription).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "webcal_subscription",
          subscriberContact: {
            countryCode: "ZW",
            phone: "077 123 4567",
            consentUpdates: true,
            consentSource: "calendar_onboarding",
          },
        }),
      ),
    );
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain(
      "077 123 4567",
    );
  });

  it("shares only the public class URL and never the private feed URL", async () => {
    const share = vi.fn(async (_data: ShareData) => undefined);
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: share,
    });
    window.history.replaceState({}, "", `/t/${timetable.publicSlug}`);
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Share with classmates" }),
    );
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls[0]?.[0];
    expect(payload).toBeDefined();
    expect(payload?.url).toBe(
      `http://localhost:3000/t/${timetable.publicSlug}`,
    );
    expect(payload?.url).not.toContain("/calendar/feed/");
    expect(payload?.url).not.toContain("private-token");
  });

  it("shows the mobile sticky CTA only after the primary CTA leaves view and hides it while the dialog is open", async () => {
    render(<PublicTimetableReliability slug={timetable.publicSlug} />);
    await screen.findByRole("heading", {
      level: 1,
      name: "BTech Computer Science",
    });
    expect(observerCallback).not.toBeNull();

    act(() => {
      observerCallback?.(
        [{ isIntersecting: false } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
    expect(
      screen.getAllByRole("button", { name: "Subscribe to calendar" }),
    ).toHaveLength(2);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Subscribe to calendar" })[1],
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Subscribe to calendar" }),
    ).toHaveLength(1);
  });
});
