import { describe, expect, it } from "vitest";
import {
  buildAttributedClassUrl,
  buildClassSharePayload,
  readClassShareSource,
  sanitizeClassShareSource,
} from "../src/domain/shareAttribution";

describe("DR-47 class share attribution", () => {
  it("accepts only the coarse non-sensitive source allowlist", () => {
    expect(sanitizeClassShareSource("class_share")).toBe("class_share");
    expect(sanitizeClassShareSource("CLASS_REP")).toBe("class_rep");
    expect(sanitizeClassShareSource("onboarding_success")).toBe(
      "onboarding_success",
    );
    expect(sanitizeClassShareSource("subscriber-123")).toBeNull();
    expect(sanitizeClassShareSource("private-token")).toBeNull();
  });

  it("rebuilds attribution from the canonical public timetable URL only", () => {
    expect(
      buildAttributedClassUrl(
        "https://calender.aido.co.zw/t/hit-cs-1?utm_source=old#private",
        "class_rep",
      ),
    ).toBe("https://calender.aido.co.zw/t/hit-cs-1?src=class_rep");
    expect(() =>
      buildAttributedClassUrl(
        "https://calender.aido.co.zw/calendar/feed/private-token.ics",
        "class_share",
      ),
    ).toThrow(/public timetable URL/i);
  });

  it("builds WhatsApp-friendly copy without implying that opening the link subscribes", () => {
    const payload = buildClassSharePayload({
      classLabel: "Class 1.1",
      publicUrl: "https://calender.aido.co.zw/t/hit-cs-1",
      source: "onboarding_success",
    });
    expect(payload.url).toBe(
      "https://calender.aido.co.zw/t/hit-cs-1?src=onboarding_success",
    );
    expect(payload.message).toContain("see tomorrow's classes");
    expect(payload.message).toContain("add it to your calendar");
    expect(payload.message).not.toMatch(
      /automatically subscribed|private-token/i,
    );
  });

  it("reads shared-link attribution only when it is allowlisted", () => {
    expect(
      readClassShareSource(
        "https://calender.aido.co.zw/t/hit-cs-1?src=class_share",
      ),
    ).toBe("class_share");
    expect(
      readClassShareSource(
        "https://calender.aido.co.zw/t/hit-cs-1?src=user-identity",
      ),
    ).toBeNull();
  });
});
