import { describe, expect, it } from "vitest";
import {
  decryptGoogleRefreshToken,
  encryptGoogleRefreshToken,
  getPublicGoogleCalendarStatus,
} from "../server/googleCalendarSync";
import { googleCalendarScope } from "../src/domain/googleScopes";

const configuredEnv = {
  GOOGLE_CLIENT_ID: "client.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "server-client-secret",
  GOOGLE_REDIRECT_URI:
    "https://calender.aido.co.zw/api/calendar/google/callback",
  TOKEN_ENCRYPTION_KEY: "test-only-dedicated-token-encryption-secret",
} as NodeJS.ProcessEnv;

describe("Google Calendar direct sync security", () => {
  it("encrypts refresh tokens with randomized authenticated ciphertext", () => {
    const first = encryptGoogleRefreshToken("refresh-token-value", configuredEnv);
    const second = encryptGoogleRefreshToken("refresh-token-value", configuredEnv);

    expect(first).not.toBe("refresh-token-value");
    expect(first).not.toBe(second);
    expect(decryptGoogleRefreshToken(first, configuredEnv)).toBe(
      "refresh-token-value",
    );
    expect(decryptGoogleRefreshToken(second, configuredEnv)).toBe(
      "refresh-token-value",
    );
  });

  it("rejects ciphertext when the encryption key changes", () => {
    const encrypted = encryptGoogleRefreshToken(
      "refresh-token-value",
      configuredEnv,
    );
    expect(() =>
      decryptGoogleRefreshToken(encrypted, {
        ...configuredEnv,
        TOKEN_ENCRYPTION_KEY: "different-secret",
      }),
    ).toThrow("Stored Google Calendar access is invalid");
  });

  it("only advertises direct Google sync when OAuth and token encryption are configured", () => {
    expect(getPublicGoogleCalendarStatus(configuredEnv)).toEqual({
      enabled: true,
      scope: googleCalendarScope,
    });
    expect(
      getPublicGoogleCalendarStatus({
        ...configuredEnv,
        TOKEN_ENCRYPTION_KEY: "",
      }),
    ).toEqual({ enabled: false, scope: googleCalendarScope });
  });

  it("uses only the purpose-built app-created calendar scope", () => {
    expect(googleCalendarScope).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
  });
});
