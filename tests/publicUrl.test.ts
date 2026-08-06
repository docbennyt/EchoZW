import { describe, expect, it } from "vitest";
import {
  getPublicAppUrlFromHeaders,
  getPublicAppUrl,
  isExternallyFetchableUrl,
} from "../src/domain/publicUrl";

describe("public URL validation", () => {
  it("trims trailing slashes", () => {
    expect(
      getPublicAppUrl(
        { PUBLIC_APP_URL: "https://calender.aido.co.zw/" },
        "production",
      ),
    ).toBe("https://calender.aido.co.zw");
  });

  it("rejects localhost production origins", () => {
    expect(() =>
      getPublicAppUrl(
        { PUBLIC_APP_URL: "http://localhost:5173" },
        "production",
      ),
    ).toThrow("HTTPS");
  });

  it("marks only public HTTPS URLs as externally fetchable", () => {
    expect(isExternallyFetchableUrl("https://calendar.example.com")).toBe(true);
    expect(isExternallyFetchableUrl("http://localhost:5173")).toBe(false);
    expect(isExternallyFetchableUrl("https://192.168.0.12")).toBe(false);
  });

  it("derives a production origin from forwarded proxy headers when env is unset", () => {
    expect(
      getPublicAppUrlFromHeaders(
        {},
        {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "calender.aido.co.zw",
          host: "internal:4173",
        },
        "production",
      ),
    ).toBe("https://calender.aido.co.zw");
  });

  it("prefers configured production origins over forwarded headers", () => {
    expect(
      getPublicAppUrlFromHeaders(
        { PUBLIC_APP_URL: "https://calender.aido.co.zw" },
        {
          "x-forwarded-proto": "https",
          "x-forwarded-host": "calendar.aido.co.zw",
        },
        "production",
      ),
    ).toBe("https://calender.aido.co.zw");
  });
});
