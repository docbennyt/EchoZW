import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PilotOfferEnhancement } from "../src/PilotOfferEnhancement";
import { track } from "../src/analytics";
import { ANALYTICS_EVENT_NAMES } from "../src/domain/analytics";

vi.mock("../src/analytics", () => ({
  track: vi.fn(),
}));

const mockedTrack = vi.mocked(track);

describe("HIT pilot offer enhancement", () => {
  beforeEach(() => {
    mockedTrack.mockReset();
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = `
      <main>
        <section id="how">How it works</section>
        <section class="czw-final-cta">Final CTA</section>
      </main>
    `;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("presents the truthful free HIT pilot and planned semester price", async () => {
    render(<PilotOfferEnhancement />);

    expect(
      await screen.findByRole("heading", {
        name: "Free through 30 September 2026.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("US$0", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("US$3 / semester")).toBeInTheDocument();
    expect(
      screen.getByText("No payment method needed during the pilot."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Local payment options planned for paid launch."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/pay now/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/urgent alerts/i)).not.toBeInTheDocument();
  });

  it("keeps the primary pilot CTA on the timetable finder and tracks it", async () => {
    render(<PilotOfferEnhancement />);

    const cta = await screen.findByRole("link", {
      name: "Find my timetable — free",
    });
    expect(cta).toHaveAttribute("href", "/find");

    fireEvent.click(cta);
    expect(mockedTrack).toHaveBeenCalledWith("pilot_cta_clicked", {
      source: "direct",
      path: "/",
    });
  });

  it("uses only allowlisted coarse class-share attribution", async () => {
    window.history.replaceState({}, "", "/?src=class_share");
    render(<PilotOfferEnhancement />);

    await waitFor(() =>
      expect(mockedTrack).toHaveBeenCalledWith("pilot_offer_viewed", {
        source: "class_share",
        path: "/",
      }),
    );
    expect(mockedTrack).toHaveBeenCalledWith("future_price_viewed", {
      source: "class_share",
      path: "/",
    });
  });

  it("registers all pilot measurement events in the analytics allowlist", () => {
    expect(ANALYTICS_EVENT_NAMES).toContain("pilot_offer_viewed");
    expect(ANALYTICS_EVENT_NAMES).toContain("pilot_cta_clicked");
    expect(ANALYTICS_EVENT_NAMES).toContain("future_price_viewed");
  });
});
