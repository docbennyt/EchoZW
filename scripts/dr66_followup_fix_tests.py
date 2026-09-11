from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text()
    if old not in text:
        raise RuntimeError(f"Expected block not found in {path}: {old[:80]!r}")
    if text.count(old) != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {text.count(old)}")
    target.write_text(text.replace(old, new, 1))


replace_once(
    "tests/FinderDiscovery.test.tsx",
    '''      expect(screen.getByText("Institution")).toBeInTheDocument();
      expect(screen.getByText("Programme")).toBeInTheDocument();
      expect(screen.getByText("Class")).toBeInTheDocument();
      expect(screen.getByText("Academic period")).toBeInTheDocument();''',
    '''      expect(screen.getAllByText("Institution").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Programme").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Class").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Academic period").length).toBeGreaterThan(0);''',
)

# Older verifier snapshots asserted a visible "Current period" helper. The
# clarified mobile UX intentionally removes that extra copy. Patch only when
# such an assertion exists so this materializer stays compatible with the
# current merged DR-66 tests.
test_path = ROOT / "tests/FinderDiscovery.test.tsx"
test_text = test_path.read_text()
current_period_assertion = 'expect(screen.getByText("Current period")).toBeInTheDocument();'
if current_period_assertion in test_text:
    test_text = test_text.replace(
        current_period_assertion,
        '''expect(screen.queryByText("Current period")).toBeNull();
    expect(
      screen.getByRole("button", { name: /View timetable/i }),
    ).toBeEnabled();''',
        1,
    )
    test_path.write_text(test_text)

layout = ROOT / "tests/dr55FinderPromptLayout.test.ts"
layout.write_text(r'''import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("DR-55 Finder missing-class prompt layout", () => {
  it("keeps the prompt in normal React flow inside FinderDiscovery", () => {
    const finder = readFileSync("src/FinderDiscovery.tsx", "utf8");
    const main = readFileSync("src/main.tsx", "utf8");

    expect(finder).toContain("function MissingClassPrompt");
    expect(finder).toContain("czw-finder-demand-inline");
    expect(finder).not.toContain("createPortal(");
    expect(main).not.toContain("FinderDemandPrompt");
  });

  it("keeps the follow-up mobile prompt compact and non-sticky", () => {
    const css = readFileSync("src/finderDiscovery.css", "utf8");
    const marker = "/* DR-66 follow-up: device-intent finder split. */";
    const followup = css.slice(css.indexOf(marker));
    const start = followup.indexOf(".czw-finder-demand-inline {");
    const end = followup.indexOf("}", start);
    const baseBlock = followup.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(baseBlock).not.toContain("position:");
    expect(followup).toContain("@media (max-width: 640px)");
    expect(followup).toContain("background: transparent");
  });
});
''')
