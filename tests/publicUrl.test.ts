import { describe, expect, it } from "vitest";
import {
  getPublicAppUrl,
  isExternallyFetchableUrl,
} from "../src/domain/publicUrl";

describe("public URL validation", () => {
  it("trims trailing slashes", () => {
    expect(
      getPublicAppUrl(
        { PUBLIC_APP_URL: "https://calendar.example.com/" },
        "production",
      ),
    ).toBe("https://calendar.example.com");
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
});
