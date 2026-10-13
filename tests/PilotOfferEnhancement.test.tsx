import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PaynowDemoPage,
  PilotOfferEnhancement,
} from "../src/PilotOfferEnhancement";

describe("CZW marketing pricing", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    document.body.innerHTML = [
      "<main>",
      '<section id="how">How it works</section>',
      '<section class="czw-final-cta">Final CTA</section>',
      "</main>",
    ].join("");
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("removes the expired pilot message and shows student and institution plans", async () => {
    render(<PilotOfferEnhancement />);
    expect(
      await screen.findByRole("heading", { name: "One less thing to worry about." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Essentials" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Complete" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Institution" })).toBeInTheDocument();
    expect(screen.getByText("Most popular")).toBeInTheDocument();
    expect(screen.getByText("US$0.50")).toBeInTheDocument();
    expect(screen.getByText("US$1")).toBeInTheDocument();
    expect(screen.queryByText(/HIT Undergraduate Pilot/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Free through 30 September 2026/i)).not.toBeInTheDocument();
    expect(screen.getByText("Exam timetable and updates not included")).toBeInTheDocument();
    expect(screen.getByText("Exam timetable and exam updates")).toBeInTheDocument();
  });

  it("switches to two-semester yearly totals and preserves demo payment links", async () => {
    render(<PilotOfferEnhancement />);
    const yearly = await screen.findByRole("button", { name: /Yearly/i });
    fireEvent.click(yearly);
    expect(yearly).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("US$6")).toBeInTheDocument();
    expect(screen.getByText("US$12")).toBeInTheDocument();
    const demos = screen.getAllByRole("link", { name: /View Paynow demo/i });
    expect(demos).toHaveLength(2);
    expect(demos[0]).toHaveAttribute("href", "/paynow-demo?plan=essentials&billing=yearly");
    expect(demos[1]).toHaveAttribute("href", "/paynow-demo?plan=complete&billing=yearly");
  });

  it("routes both institution and Timely sales calls to the published number", async () => {
    render(<PilotOfferEnhancement />);
    await screen.findByRole("heading", { name: "Institution" });
    const sales = screen.getAllByRole("link", { name: /Contact Sales/i });
    expect(sales).toHaveLength(2);
    sales.forEach((link) =>
      expect(link).toHaveAttribute("href", "tel:+263777318411"),
    );
    expect(screen.getByText("US$25", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Nicolas,\s+your human study coach/i)).toBeInTheDocument();
    expect(screen.queryByText(/turnitin|bypass/i)).not.toBeInTheDocument();
  });

  it("opens a clearly non-transactional Paynow demonstration", () => {
    window.history.replaceState({}, "", "/paynow-demo?plan=complete&billing=yearly");
    render(<PaynowDemoPage />);
    expect(
      screen.getByRole("heading", { name: "Preview only. No payment will be taken." }),
    ).toBeInTheDocument();
    expect(screen.getByText("US$12")).toBeInTheDocument();
    expect(screen.getByText(/not a Paynow-hosted checkout/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Back to pricing/i })).toHaveAttribute(
      "href",
      "/#pricing",
    );
    expect(screen.queryByRole("button", { name: /pay now/i })).not.toBeInTheDocument();
  });
});
