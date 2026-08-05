import { fireEvent, render, screen } from "@testing-library/react";
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

    expect(screen.getByRole("link", { name: "Privacy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute(
      "href",
      "/terms",
    );
    expect(screen.getByRole("link", { name: "Data deletion" })).toHaveAttribute(
      "href",
      "/data-deletion",
    );
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
      screen.getByRole("heading", { name: /Continue with Google Calendar/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/do not use this permission to read/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", {
        name: /Learn how Google Calendar data is used/i,
      }),
    ).toHaveAttribute("href", "/privacy#google-calendar-data");
  });
});
