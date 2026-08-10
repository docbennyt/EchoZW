import { describe, expect, it } from "vitest";
import { injectSpaMetadata } from "../server/spaMetadata";

const shell = `
<!doctype html>
<html lang="en">
  <head>
    <meta name="description" content="default description" />
    <link rel="canonical" href="https://calender.aido.co.zw/" />
    <meta property="og:title" content="CalenderZW" />
    <meta property="og:description" content="default og description" />
    <meta property="og:url" content="https://calender.aido.co.zw/" />
    <title>CalenderZW</title>
  </head>
  <body></body>
</html>
`;

describe("SPA metadata injection", () => {
  it("injects public timetable metadata without exposing private feed URLs", () => {
    const html = injectSpaMetadata(shell, {
      title: "HIT · BTech Computer Science · Class 1.1",
      description:
        "August Semester 2026 published timetable. View your classes and add them to your calendar with CalenderZW.",
      canonicalPath: "/t/hit-ics-1-1-august-semester-2026",
    });

    expect(html).toContain("<title>HIT · BTech Computer Science · Class 1.1</title>");
    expect(html).toContain('property="og:title" content="HIT · BTech Computer Science · Class 1.1"');
    expect(html).toContain('property="og:url" content="https://calender.aido.co.zw/t/hit-ics-1-1-august-semester-2026"');
    expect(html).toContain('rel="canonical" href="https://calender.aido.co.zw/t/hit-ics-1-1-august-semester-2026"');
    expect(html).not.toContain("/calendar/feed/");
  });
});
