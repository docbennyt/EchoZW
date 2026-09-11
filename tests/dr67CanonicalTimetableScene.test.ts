import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preview = readFileSync("src/PersonalTimetablePreview.tsx", "utf8");
const exportDomain = readFileSync(
  "src/domain/personalTimetableExport.ts",
  "utf8",
);
const sceneDomain = readFileSync(
  "src/domain/personalTimetableScene.ts",
  "utf8",
);
const publicTimetable = readFileSync(
  "src/PublicTimetableReliability.tsx",
  "utf8",
);

describe("DR-67 canonical timetable scene contract", () => {
  it("makes browser preview, PNG and PDF consume the same scene", () => {
    expect(preview).toContain("buildPersonalTimetableScene(model)");
    expect(preview).toContain("buildPersonalTimetableSvg(scene)");
    expect(preview).toContain("<PreviewSheet scene={scene} svg={svg} />");
    expect(preview).toContain("buildPersonalTimetablePdf(scene)");
    expect(preview).toContain("svgToPng(svg, scene.width, scene.height)");
    expect(preview).toContain("dangerouslySetInnerHTML={{ __html: svg }}");
  });

  it("keeps layout decisions in the scene instead of renderer-specific algorithms", () => {
    expect(sceneDomain).toContain(
      "export function buildPersonalTimetableScene",
    );
    expect(sceneDomain).toContain("courseNameLines");
    expect(sceneDomain).toContain("detailLines");
    expect(sceneDomain).toContain("No published sessions");
    expect(sceneDomain).toContain("SESSION_PALETTE");
    expect(exportDomain).toContain("scene.elements.map(svgElement)");
    expect(exportDomain).toContain("scene.elements");
    expect(exportDomain).not.toContain("function truncate(");
  });

  it("does not make visual preview public unless the durable founder setting is on", () => {
    expect(publicTimetable).toContain(
      "timetable.publicDisplay?.showVisualPreview === true",
    );
    expect(publicTimetable).toContain(
      "<PersonalTimetablePreview slug={slug} timetable={timetable} />",
    );
  });
});
