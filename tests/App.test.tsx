import { render, screen } from "@testing-library/react";
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
});
