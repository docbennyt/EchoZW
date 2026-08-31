import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { PASSWORD_RESET_SENT_MESSAGE } from "../src/authRecovery";
import type { PublicTimetable } from "../src/api/pilotTypes";

const createSupabaseClient = vi.fn();

const publishedTimetable: PublicTimetable = {
  timetableId: "tt-hit-1",
  publicSlug: "hit-ics-1-1-august-semester-2026",
  institution: "Harare Institute of Technology",
  institutionShortName: "HIT",
  institutionTimezone: "Africa/Harare",
  programme: "BTech Computer Science",
  classGroup: "1.1",
  academicPeriod: "August Semester 2026",
  startsOn: "2026-08-10",
  endsOn: "2026-12-10",
  publishedAt: "2026-08-09T08:00:00.000Z",
  versionNumber: 1,
  sessions: [
    {
      stableSessionKey: "mon-0800",
      courseCode: "HIT1101",
      courseName: "Technopreneurship I",
      weekday: 1,
      startTime: "08:00:00",
      endTime: "10:00:00",
      venue: "E/HALL",
      lecturer: "TDC",
      sessionType: "Lecture",
      notes: null,
    },
    {
      stableSessionKey: "wed-1100",
      courseCode: "HCS1204",
      courseName: "Discrete Mathematics",
      weekday: 3,
      startTime: "11:00:00",
      endTime: "13:00:00",
      venue: "A1",
      lecturer: "Moyo",
      sessionType: "Lecture",
      notes: null,
    },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installPublicTimetableFetchMock(options?: {
  subscriptionResponse?: Record<string, unknown>;
  timetable?: PublicTimetable;
}) {
  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (url.includes("/api/public/timetables/")) {
        return jsonResponse({
          timetable: options?.timetable ?? publishedTimetable,
        });
      }
      if (url === "/api/calendar/subscriptions" && init?.method === "POST") {
        return jsonResponse(
          options?.subscriptionResponse ?? {
            subscriptionId: "sub-1",
            provider: "webcal_subscription",
            calendarName: "BTech Computer Science - August Semester 2026",
            feedUrl:
              "https://calender.aido.co.zw/calendar/feed/private-token.ics",
            appleSubscribeUrl:
              "webcal://calender.aido.co.zw/calendar/feed/private-token.ics",
            downloadUrl:
              "https://calender.aido.co.zw/calendar/download/sub-1.ics",
            warnings: [],
            expiresAt: null,
          },
          201,
        );
      }
      return new Response("{}", { status: 401 });
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

vi.mock("../src/utils/supabase/client", () => ({
  createClient: () => createSupabaseClient(),
}));

beforeEach(() => {
  createSupabaseClient.mockReset();
  createSupabaseClient.mockImplementation(() => {
    throw new Error("Supabase test config missing");
  });
  Object.defineProperty(window.navigator, "userAgent", {
    configurable: true,
    value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    configurable: true,
    value: 0,
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    value: undefined,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
});

describe("public student flow", () => {
  it("shows an honest unavailable state for timetable links without requiring login", async () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Timetable unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This timetable has not been published yet/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/BSc Software Engineering/i)).toBeNull();
    expect(screen.queryByText(/Weekly agenda/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Add to my calendar/i }),
    ).toBeNull();
  });

  it("shows class identity, trust, upcoming context, and the calendar CTA before the schedule", async () => {
    installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "BTech Computer Science",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("HIT")).toBeInTheDocument();
    expect(screen.getByText("Class 1.1")).toBeInTheDocument();
    expect(screen.getByText("August Semester 2026")).toBeInTheDocument();
    expect(screen.getByText(/Published by CalenderZW/i)).toBeInTheDocument();
    expect(screen.getByText(/Next class/i)).toBeInTheDocument();
    expect(screen.getAllByText("Technopreneurship I").length).toBeGreaterThan(
      0,
    );

    const cta = screen.getByRole("button", {
      name: /Add timetable to my calendar/i,
    });
    const scheduleHeading = screen.getByRole("heading", {
      level: 2,
      name: /Useful now, full week when you need it/i,
    });
    expect(
      cta.compareDocumentPosition(scheduleHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  });

  it("keeps On time selected by default and creates subscriptions only on intentional method selection", async () => {
    const fetchMock = installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Add timetable to my calendar/i,
      }),
    );

    const dialog = screen.getByRole("dialog", {
      name: /When should we remind you/i,
    });
    expect(
      within(dialog).getByRole("radio", { name: /On time/i }),
    ).toBeChecked();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/calendar/subscriptions"),
      ),
    ).toHaveLength(0);

    expect(
      within(dialog).getByText(/How should we deliver it/i),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).includes("/api/calendar/subscriptions"),
      ),
    ).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: /Subscribe using calendar URL/i }),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/calendar/subscriptions"),
        ),
      ).toHaveLength(1),
    );
    expect(
      await screen.findByText(/Your timetable is ready/i),
    ).toBeInTheDocument();
  });

  it("closes the reminder dialog with Escape and restores focus to the calendar CTA", async () => {
    installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    const cta = await screen.findByRole("button", {
      name: /Add timetable to my calendar/i,
    });
    fireEvent.click(cta);
    expect(
      screen.getByRole("dialog", { name: /When should we remind you/i }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /When should we remind you/i }),
      ).toBeNull(),
    );
    expect(cta).toHaveFocus();
  });

  it("shares the public timetable URL after calendar setup, never the private feed URL", async () => {
    const share = vi.fn(async (_payload?: unknown) => undefined);
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      value: share,
    });
    installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Add timetable to my calendar/i,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Subscribe using calendar URL/i }),
    );

    const successTitle = await screen.findByText(/Your timetable is ready/i);
    const successCard = successTitle.closest("section");
    expect(successCard).not.toBeNull();
    fireEvent.click(
      within(successCard as HTMLElement).getByRole("button", {
        name: /Share with classmates/i,
      }),
    );

    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const payload = share.mock.calls.at(0)?.[0] as { url?: string } | undefined;
    expect(payload).toBeDefined();
    expect(payload?.url ?? "").toContain("/t/hit-ics-1-1-august-semester-2026");
    expect(JSON.stringify(payload ?? {})).not.toContain("/calendar/feed/");
  });

  it("shows honest Android delivery copy without claiming one-tap Google Calendar subscription", async () => {
    Object.defineProperty(window.navigator, "userAgent", {
      configurable: true,
      value: "Mozilla/5.0 (Linux; Android 14; Pixel 8)",
    });
    installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Add timetable to my calendar/i,
      }),
    );

    expect(
      screen.getByRole("button", { name: /Download calendar file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Copy subscription link/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Google Calendar direct sync/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Coming soon/i)).toBeInTheDocument();
    expect(screen.queryByText(/Subscribe in Google Calendar/i)).toBeNull();
  });

  it("lets the user set a custom reminder with hours and minutes before choosing delivery", async () => {
    const fetchMock = installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    render(<App />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Add timetable to my calendar/i,
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: /Custom/i }));
    fireEvent.change(screen.getByLabelText(/Hours before class/i), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/Minutes before class/i), {
      target: { value: "15" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /Subscribe using calendar URL/i }),
    );

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).includes("/api/calendar/subscriptions"),
        ),
      ).toHaveLength(1),
    );

    const subscriptionCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/api/calendar/subscriptions"),
    );
    expect(subscriptionCall).toBeDefined();
    const body = JSON.parse(
      String((subscriptionCall?.[1] as RequestInit | undefined)?.body ?? "{}"),
    );
    expect(body.reminderPreset).toBe("custom");
    expect(body.customReminderOffsets).toEqual([135]);
  });

  it("shows legal footer links on the public homepage", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /Your university timetable/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/CalenderZW/i).length).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("link", { name: /CalenderZW home/i })[0],
    ).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toHaveAttribute(
      "data-component",
      "GlobalFooter",
    );
    expect(
      screen.getByText(/No student account is required/i),
    ).toBeInTheDocument();
    const footer = screen.getByRole("contentinfo");
    const footerLinks = within(footer);
    expect(
      footerLinks.getByRole("link", { name: "Privacy" }),
    ).toBeInTheDocument();
    expect(
      footerLinks.getByRole("link", { name: "Terms" }),
    ).toBeInTheDocument();
    expect(
      footerLinks.getByRole("link", { name: "Data deletion" }),
    ).toBeInTheDocument();
    expect(
      footerLinks.getByRole("link", { name: "Support" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/BSc Software Engineering/i)).toBeNull();
  });

  it("renders an unambiguous first-viewport app identity", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    const hero = document.querySelector(".hero");
    expect(hero).not.toBeNull();
    // VPS landing page uses eyebrow + h1 pattern instead of product-name/product-category
    expect(hero?.querySelector(".eyebrow")?.textContent).toContain(
      "Your timetable, already organised",
    );
    expect(hero?.querySelector("h1")?.textContent).toContain(
      "Your university timetable",
    );
    expect(hero?.textContent).toContain(
      "CalenderZW helps students find a published class timetable",
    );
    expect(hero?.textContent).not.toContain("CalenderZW by aiDo");
    expect(screen.getAllByText(/Operated by aiDo/i).length).toBeGreaterThan(0);
  });

  it("uses one shared accessible header and mobile menu on public pages", () => {
    for (const path of [
      "/",
      "/privacy",
      "/terms",
      "/data-deletion",
      "/support",
    ]) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<App />);
      expect(
        document.querySelectorAll('[data-component="GlobalHeader"]'),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll('[data-component="GlobalFooter"]'),
      ).toHaveLength(1);
      // Brand link renders as /#top on the homepage (SPA anchor), but / on sub-pages
      const homeLinks = screen.getAllByRole("link", {
        name: /CalenderZW home/i,
      });
      expect(homeLinks.length).toBeGreaterThan(0);
      expect(
        screen.getByRole("button", { name: /Open navigation menu/i }),
      ).toHaveAttribute("aria-controls", "global-navigation");
      unmount();
    }

    installPublicTimetableFetchMock();
    window.history.pushState({}, "", "/t/hit-ics-1-1-august-semester-2026");
    const timetableRoute = render(<App />);
    expect(
      document.querySelectorAll('[data-component="GlobalHeader"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-component="CompactFooter"]'),
    ).toHaveLength(1);
    expect(
      document.querySelectorAll('[data-component="GlobalFooter"]'),
    ).toHaveLength(0);
    timetableRoute.unmount();

    window.history.pushState({}, "", "/");
    render(<App />);
    fireEvent.click(
      screen.getByRole("button", { name: /Open navigation menu/i }),
    );
    expect(
      screen.getByRole("button", { name: /Close navigation menu/i }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("renders legal and data deletion pages without authentication", () => {
    for (const path of ["/privacy", "/terms", "/data-deletion"]) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<App />);
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      unmount();
    }
  });

  it("does not expose calendar setup actions from unavailable timetable links", async () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Timetable unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add to Google Calendar/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /Download .ics/i })).toBeNull();
  });

  it("renders support and readiness pages without exposing secrets", () => {
    window.history.pushState({}, "", "/support");
    const support = render(<App />);
    expect(
      screen.getByRole("heading", { name: /CalenderZW support/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/support@aido\.co\.zw/i).length).toBeGreaterThan(
      0,
    );
    support.unmount();

    window.history.pushState({}, "", "/admin/google-verification-readiness");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /Google verification readiness/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("CalenderZW").length).toBeGreaterThan(0);
    expect(screen.getByText("OAuth app name expected")).toBeInTheDocument();
    expect(screen.getByText("Homepage visible app name")).toBeInTheDocument();
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Raw HTML app-name match")).toBeInTheDocument();
    expect(screen.getByText("Metadata app-name match")).toBeInTheDocument();
    expect(screen.getByText("Manifest app-name match")).toBeInTheDocument();
    expect(
      screen.getAllByText(/requires manual confirmation/i).length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByText(/GOOGLE_CLIENT_SECRET|refresh_token|ya29\./i),
    ).toBeNull();
  });

  it("redirects anonymous admin child routes to the real login form", async () => {
    window.history.pushState({}, "", "/admin/timetables");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Admin login/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password$/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Sign in/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /create account|sign up/i }),
    ).toBeNull();
    expect(screen.queryByText(/Lecture CRUD/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Publish new version/i }),
    ).toBeNull();
  });

  it("redirects anonymous admin root access to the login form", async () => {
    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Admin login/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/login");
    expect(screen.queryByText(/Lecture CRUD/i)).toBeNull();
    expect(screen.queryByText(/Admin timetables/i)).toBeNull();
  });

  it("shows forbidden state for authenticated non-admin users", async () => {
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "valid-non-admin" } },
        })),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "FORBIDDEN",
                message: "This account does not have administrator access.",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Administrator access/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/does not have CalenderZW administrator access/i)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/Admin access verified/i)).toBeNull();
  });

  it("shows the minimal admin shell for active admins", async () => {
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "valid-admin" } },
        })),
        signOut: vi.fn(async () => ({ error: null })),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              authenticated: true,
              admin: true,
              user: { id: "admin-1", email: "admin@example.test" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    window.history.pushState({}, "", "/admin");
    render(<App />);

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /CalenderZW Admin/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("admin@example.test")).toBeInTheDocument();
    expect(screen.getByText(/Get a class timetable live/i)).toBeInTheDocument();
    expect(screen.queryByText(/Lecture CRUD/i)).toBeNull();
  });

  it("signs out and clears the admin shell", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "valid-admin" } },
        })),
        signOut,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              authenticated: true,
              admin: true,
              user: { id: "admin-1", email: "admin@example.test" },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    window.history.pushState({}, "", "/admin");
    render(<App />);

    await screen.findByRole("heading", {
      level: 1,
      name: /CalenderZW Admin/i,
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(window.location.pathname).toBe("/admin/login");
    expect(
      await screen.findByRole("heading", { name: /Admin login/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("admin@example.test")).toBeNull();
  });

  it("shows invalid credentials without revealing account existence", async () => {
    createSupabaseClient.mockReturnValue({
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: { session: null },
          error: new Error("Invalid login credentials"),
        })),
      },
    });

    window.history.pushState({}, "", "/admin/login");
    render(<App />);

    fireEvent.change(screen.getByLabelText(/^Email$/i), {
      target: { value: "missing@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(
      await screen.findByText("Email or password is incorrect."),
    ).toBeInTheDocument();
  });

  it("requests an admin password reset with the account update redirect", async () => {
    const resetPasswordForEmail = vi.fn(async () => ({
      data: {},
      error: null,
    }));
    createSupabaseClient.mockReturnValue({
      auth: {
        resetPasswordForEmail,
      },
    });

    window.history.pushState({}, "", "/admin/login");
    render(<App />);

    fireEvent.change(screen.getByLabelText(/^Email$/i), {
      target: { value: "admin@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Forgot password/i }));

    await waitFor(() =>
      expect(resetPasswordForEmail).toHaveBeenCalledWith("admin@example.test", {
        redirectTo: `${window.location.origin}/account/update-password`,
      }),
    );
    expect(
      await screen.findByText(PASSWORD_RESET_SENT_MESSAGE),
    ).toHaveAttribute("role", "status");
    expect(PASSWORD_RESET_SENT_MESSAGE).not.toMatch(
      /registered|found|missing/i,
    );
  });

  it("renders the production password update route and rejects mismatched passwords", async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "recovery-session" } },
          error: null,
        })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        updateUser,
      },
    });

    window.history.pushState(
      {},
      "",
      "/account/update-password#access_token=secret&type=recovery",
    );
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Update password/i }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: "different-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Update password/i }));

    expect(
      await screen.findByText("The passwords do not match."),
    ).toHaveAttribute("role", "alert");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("updates the password through Supabase after a recovery session is restored", async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "recovery-session" } },
          error: null,
        })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        updateUser,
      },
    });

    window.history.pushState({}, "", "/account/update-password");
    render(<App />);

    fireEvent.change(await screen.findByLabelText(/^New password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Update password/i }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith({
        password: "new-secure-password",
      }),
    );
    expect(
      await screen.findByRole("link", { name: /Continue to admin/i }),
    ).toHaveAttribute("href", "/admin");
  });

  it("shows a new reset path for invalid or expired recovery links", async () => {
    createSupabaseClient.mockReturnValue({
      auth: {
        getSession: vi.fn(async () => ({
          data: { session: null },
          error: new Error("expired"),
        })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
      },
    });

    window.history.pushState({}, "", "/account/update-password");
    render(<App />);

    expect(
      await screen.findByText(
        "This password reset link is invalid or has expired. Request a new one.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Request another reset/i }),
    ).toHaveAttribute("href", "/admin/login");
  });

  it("completes auth callback processing without granting admin client-side", async () => {
    const exchangeCodeForSession = vi.fn(async () => ({
      data: {},
      error: null,
    }));
    createSupabaseClient.mockReturnValue({
      auth: {
        exchangeCodeForSession,
        getSession: vi.fn(async () => ({
          data: { session: { access_token: "valid-non-admin" } },
          error: null,
        })),
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "FORBIDDEN",
                message: "This account does not have administrator access.",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    window.history.pushState({}, "", "/auth/callback?code=secret-auth-code");
    render(<App />);

    await waitFor(() =>
      expect(exchangeCodeForSession).toHaveBeenCalledWith("secret-auth-code"),
    );
    await waitFor(() =>
      expect(window.location.pathname).toBe("/account/settings"),
    );
    expect(window.location.search).toBe("");
  });

  it("rejects login for authenticated users without admin authorization", async () => {
    const signOut = vi.fn(async () => ({ error: null }));
    createSupabaseClient.mockReturnValue({
      auth: {
        signInWithPassword: vi.fn(async () => ({
          data: { session: { access_token: "valid-non-admin" } },
          error: null,
        })),
        signOut,
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: {
                code: "FORBIDDEN",
                message: "This account does not have administrator access.",
              },
            }),
            { status: 403, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );

    window.history.pushState({}, "", "/admin/login");
    render(<App />);

    fireEvent.change(screen.getByLabelText(/^Email$/i), {
      target: { value: "user@example.test" },
    });
    fireEvent.change(screen.getByLabelText(/^Password$/i), {
      target: { value: "correct-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Sign in/i }));

    expect(
      await screen.findByText(
        "This account does not have CalenderZW administrator access.",
      ),
    ).toBeInTheDocument();
    expect(signOut).toHaveBeenCalled();
  });

  it("redirects dashboard paths to the canonical admin route", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: /Admin login/i }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/login");
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();
    expect(screen.queryByText("1,248")).toBeNull();
  });
});
