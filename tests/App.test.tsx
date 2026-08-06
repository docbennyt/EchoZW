import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";

const createSupabaseClient = vi.fn();

vi.mock("../src/utils/supabase/client", () => ({
  createClient: () => createSupabaseClient(),
}));

beforeEach(() => {
  createSupabaseClient.mockImplementation(() => {
    throw new Error("Supabase test config missing");
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
});

describe("public student flow", () => {
  it("shows an honest unavailable state for timetable links without requiring login", () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Timetable unavailable/i }),
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

  it("shows legal footer links on the public homepage", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    expect(
      screen.getByRole("heading", {
        name: /Add your university timetable to your calendar/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("CalenderZW").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: /CalenderZW home/i }),
    ).toHaveAttribute("href", "/");
    expect(screen.getByRole("contentinfo")).toHaveAttribute(
      "data-component",
      "GlobalFooter",
    );
    expect(
      screen.getByText(/Google Calendar connection is optional/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: /Why CalenderZW asks for Google Calendar access/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("link", { name: "Find my timetable" })[0],
    ).toHaveAttribute("href", "/find");
    const footer = screen.getByRole("contentinfo");
    const footerLinks = within(footer);
    expect(
      footerLinks.getByRole("link", { name: "Privacy Policy" }),
    ).toHaveAttribute("href", "/privacy");
    expect(
      footerLinks.getByRole("link", { name: "Terms of Service" }),
    ).toHaveAttribute("href", "/terms");
    expect(
      footerLinks.getByRole("link", { name: "Data deletion" }),
    ).toHaveAttribute("href", "/data-deletion");
    expect(
      footerLinks.getByRole("link", { name: "Help centre" }),
    ).toHaveAttribute("href", "/support");
    expect(footerLinks.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "href",
      "/support",
    );
    expect(screen.queryByText(/BSc Software Engineering/i)).toBeNull();
  });

  it("renders an unambiguous first-viewport app identity", () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    const hero = document.querySelector(".home-hero");
    expect(hero).not.toBeNull();
    expect(hero?.querySelector(".product-name")?.textContent).toBe(
      "CalenderZW",
    );
    expect(hero?.querySelector(".product-category")?.textContent).toBe(
      "Student timetable and calendar synchronisation, operated by aiDo.",
    );
    expect(hero?.textContent).toContain(
      "CalenderZW helps students find a verified class timetable, choose useful reminder times, and add lectures to Google Calendar, Apple Calendar, Outlook, or another calendar application.",
    );
    expect(hero?.textContent).toContain(
      "Google Calendar connection is optional. When you choose direct Google Calendar synchronisation",
    );
    expect(hero?.textContent).toContain(
      "It does not read or modify events in your existing personal calendars.",
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
      "/t/zou-bscse-2-1-2026-s2",
    ]) {
      window.history.pushState({}, "", path);
      const { unmount } = render(<App />);
      expect(
        document.querySelectorAll('[data-component="GlobalHeader"]'),
      ).toHaveLength(1);
      expect(
        document.querySelectorAll('[data-component="GlobalFooter"]'),
      ).toHaveLength(1);
      expect(
        screen.getByRole("link", { name: /CalenderZW home/i }),
      ).toHaveAttribute("href", "/");
      expect(
        screen.getByRole("button", { name: /Open navigation menu/i }),
      ).toHaveAttribute("aria-controls", "global-navigation");
      unmount();
    }

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

  it("does not expose calendar setup actions from unavailable timetable links", () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Timetable unavailable/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Add to Google Calendar/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Download .ics/i }),
    ).toBeNull();
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
    expect(screen.getByRole("button", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create account|sign up/i })).toBeNull();
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
      vi.fn(async () =>
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
      vi.fn(async () =>
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
        name: /Admin access verified/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("admin@example.test")).toBeInTheDocument();
    expect(screen.getByText(/CRUD begins in Phase 4/i)).toBeInTheDocument();
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
      vi.fn(async () =>
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
      name: /Admin access verified/i,
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
      vi.fn(async () =>
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
