import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-55 Finder missing-class prompt layout", () => {
  it("portals the prompt into the Finder shell before the footer", () => {
    const prompt = readFileSync("src/FinderDemandPrompt.tsx", "utf8");
    const main = readFileSync("src/main.tsx", "utf8");

    expect(prompt).toContain('from "react-dom"');
    expect(prompt).toContain("createPortal(");
    expect(prompt).toContain(".czw-finder-wrap > .czw-shell");
    expect(main).toContain('path === "/find" || path === "/find/"');
    expect(main).toContain("<FinderDemandPrompt />");
  });

  it("uses normal-flow, safe-area-aware responsive styling", () => {
    const css = readFileSync("src/productionUxEnhancementsPatch.css", "utf8");
    const block = css.match(
      /\.czw-finder-wrap \.czw-finder-demand-prompt \{([\s\S]*?)\n\}/,
    )?.[1];

    expect(block).toBeTruthy();
    expect(block).toContain("position: relative");
    expect(block).not.toContain("position: fixed");
    expect(block).not.toContain("position: sticky");
    expect(block).not.toMatch(/\bbottom\s*:/);
    expect(css).toContain("env(safe-area-inset-bottom)");
    expect(css).toContain("@media (max-width: 640px)");
    expect(css).toContain("min-height: 48px");
    expect(css).toContain("width: 100%");
  });
});
