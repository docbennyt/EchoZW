import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("public student flow", () => {
  it("renders the shared timetable page without requiring login", () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /BSc Software Engineering/i }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /Add to my calendar/i }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/Official/i)).toBeInTheDocument();
    expect(screen.getByText(/Weekly agenda/i)).toBeInTheDocument();
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

  it("shows Google data disclosure before OAuth continues", () => {
    window.history.pushState({}, "", "/t/zou-bscse-2-1-2026-s2");
    render(<App />);

    fireEvent.click(
      screen.getAllByRole("button", { name: /Add to my calendar/i })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.click(
      screen.getByRole("button", { name: /Add to Google Calendar/i }),
    );

    expect(
      screen.getByRole("heading", { name: /Connect Google Calendar/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not use this permission to read/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Learn how Google Calendar data is used/i,
      }),
    ).toHaveAttribute("href", "/privacy#google-calendar-data");
    expect(
      screen.getByRole("button", { name: /Continue to Google/i }),
    ).toBeInTheDocument();
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
    expect(screen.getByText(/Requires external confirmation/i)).toBeInTheDocument();
    expect(
      screen.queryByText(/GOOGLE_CLIENT_SECRET|refresh_token|ya29\./i),
    ).toBeNull();
  });

  it("blocks mock admin access until secure authentication is implemented", () => {
    window.history.pushState({}, "", "/admin/timetables");
    render(<App />);

    expect(
      screen.getByRole("heading", { name: /Admin login/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Admin sign-in unavailable/i)).toBeInTheDocument();
    expect(screen.queryByText(/Lecture CRUD/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Publish new version/i }),
    ).toBeNull();
  });
});
