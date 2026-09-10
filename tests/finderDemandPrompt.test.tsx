import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FinderDemandPrompt } from "../src/FinderDemandPrompt";

describe("FinderDemandPrompt", () => {
  it("portals the CTA into the finder content shell instead of floating over the footer", async () => {
    const finderWrap = document.createElement("div");
    finderWrap.className = "czw-finder-wrap";
    const shell = document.createElement("div");
    shell.className = "czw-shell";
    finderWrap.append(shell);
    document.body.append(finderWrap);

    render(<FinderDemandPrompt />);

    const prompt = await screen.findByLabelText("Missing timetable");
    expect(shell.contains(prompt)).toBe(true);
    expect(prompt.style.position).toBe("relative");
    expect(prompt.style.zIndex).toBe("auto");
    expect(screen.getByRole("link", { name: "Request timetable" })).toHaveAttribute(
      "href",
      "/request",
    );

    finderWrap.remove();
  });
});
