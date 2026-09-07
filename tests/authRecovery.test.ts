import { describe, expect, it, vi } from "vitest";
import {
  authSetupIntentFromUrl,
  clearSensitiveAuthUrl,
  getPasswordResetRedirect,
  hasAuthRedirectParameters,
  PASSWORD_RESET_PATH,
  PASSWORD_RESET_SENT_MESSAGE,
  restoreAuthSessionFromRedirect,
  safeAuthNextPath,
  validateNewPassword,
} from "../src/authRecovery";
import { BRAND } from "../src/config/brand";

function authMock(options?: {
  session?: object | null;
  exchangeError?: Error | null;
  setSessionError?: Error | null;
  verifyError?: Error | null;
}) {
  return {
    exchangeCodeForSession: vi.fn(async () => ({
      data: {},
      error: options?.exchangeError ?? null,
    })),
    setSession: vi.fn(async () => ({
      data: {},
      error: options?.setSessionError ?? null,
    })),
    verifyOtp: vi.fn(async () => ({
      data: {},
      error: options?.verifyError ?? null,
    })),
    getSession: vi.fn(async () => ({
      data: {
        session:
          options && "session" in options
            ? options.session
            : { access_token: "established-session" },
      },
      error: null,
    })),
  };
}

describe("auth recovery helpers", () => {
  it("builds the production password recovery redirect from the canonical origin", () => {
    expect(getPasswordResetRedirect(BRAND.origin)).toBe(
      "https://calender.aido.co.zw/account/update-password",
    );
  });

  it("keeps the reset success message generic", () => {
    expect(PASSWORD_RESET_SENT_MESSAGE).toBe(
      "If an account exists for that email, a password reset link has been sent.",
    );
    expect(PASSWORD_RESET_SENT_MESSAGE).not.toMatch(
      /registered|found|missing/i,
    );
  });

  it("rejects password mismatches before calling Supabase", () => {
    expect(validateNewPassword("strong-password", "different-password")).toBe(
      "The passwords do not match.",
    );
  });

  it("detects sensitive auth redirect parameters in query strings and URL hashes", () => {
    expect(
      hasAuthRedirectParameters(
        new URL(
          `https://calender.aido.co.zw${PASSWORD_RESET_PATH}#access_token=secret&type=recovery`,
        ),
      ),
    ).toBe(true);
    expect(
      hasAuthRedirectParameters(
        new URL("https://calender.aido.co.zw/auth/callback?code=secret"),
      ),
    ).toBe(true);
  });

  it("removes sensitive auth material from the browser URL", () => {
    window.history.replaceState(
      {},
      "",
      `${PASSWORD_RESET_PATH}?code=secret#access_token=also-secret&type=invite`,
    );
    clearSensitiveAuthUrl(PASSWORD_RESET_PATH);
    expect(window.location.pathname).toBe(PASSWORD_RESET_PATH);
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("secret");
  });

  it("allows only narrowly approved internal auth destinations", () => {
    expect(safeAuthNextPath("/account/update-password")).toBe(
      "/account/update-password",
    );
    expect(safeAuthNextPath("/admin")).toBe("/admin");
    expect(safeAuthNextPath("/account/settings")).toBe("/account/settings");
    for (const unsafe of [
      "https://evil.example",
      "//evil.example",
      "javascript:alert(1)",
      "data:text/html,hello",
      "\\evil.example",
      "/%2f%2fevil.example",
    ]) {
      expect(safeAuthNextPath(unsafe)).toBe(PASSWORD_RESET_PATH);
    }
  });

  it("identifies invitation and recovery intent without treating arbitrary types as trusted", () => {
    expect(
      authSetupIntentFromUrl(
        new URL(
          "https://calender.aido.co.zw/account/update-password#type=invite",
        ),
      ),
    ).toBe("invite");
    expect(
      authSetupIntentFromUrl(
        new URL(
          "https://calender.aido.co.zw/account/update-password?type=recovery",
        ),
      ),
    ).toBe("recovery");
    expect(
      authSetupIntentFromUrl(
        new URL(
          "https://calender.aido.co.zw/account/update-password?type=admin",
        ),
      ),
    ).toBe("unknown");
  });

  it("establishes an implicit Class Rep invite session deliberately", async () => {
    const auth = authMock();
    const sanitize = vi.fn();
    const result = await restoreAuthSessionFromRedirect(
      auth as never,
      new URL(
        "https://calender.aido.co.zw/account/update-password#access_token=test-access&refresh_token=test-refresh&type=invite",
      ),
      { fallbackIntent: "recovery", sanitize },
    );

    expect(sanitize).toHaveBeenCalledTimes(1);
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "test-access",
      refresh_token: "test-refresh",
    });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      intent: "invite",
      sessionEstablished: true,
    });
  });

  it("fails closed for malformed implicit invitation credentials", async () => {
    const auth = authMock();
    const result = await restoreAuthSessionFromRedirect(
      auth as never,
      new URL(
        "https://calender.aido.co.zw/account/update-password#access_token=test-access&type=invite",
      ),
      { fallbackIntent: "recovery", sanitize: vi.fn() },
    );

    expect(auth.setSession).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      intent: "invite",
      code: "AUTH_INVITE_CALLBACK_INVALID",
    });
  });

  it("explicitly exchanges a PKCE recovery code before session validation", async () => {
    const auth = authMock();
    const result = await restoreAuthSessionFromRedirect(
      auth as never,
      new URL(
        "https://calender.aido.co.zw/account/update-password?code=test-code",
      ),
      { fallbackIntent: "recovery", sanitize: vi.fn() },
    );

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("test-code");
    expect(auth.getSession).toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      intent: "recovery",
      sessionEstablished: true,
    });
  });

  it.each(["invite", "recovery"] as const)(
    "verifies canonical token-hash %s callbacks",
    async (type) => {
      const auth = authMock();
      const result = await restoreAuthSessionFromRedirect(
        auth as never,
        new URL(
          `https://calender.aido.co.zw/auth/confirm?token_hash=test-hash&type=${type}&next=/account/update-password`,
        ),
        { sanitize: vi.fn() },
      );

      expect(auth.verifyOtp).toHaveBeenCalledWith({
        token_hash: "test-hash",
        type,
      });
      expect(result).toEqual({
        ok: true,
        intent: type,
        sessionEstablished: true,
      });
    },
  );

  it("rejects unsupported callback types before establishing a session", async () => {
    const auth = authMock();
    const result = await restoreAuthSessionFromRedirect(
      auth as never,
      new URL(
        "https://calender.aido.co.zw/auth/confirm?token_hash=test-hash&type=magiclink",
      ),
      { sanitize: vi.fn() },
    );

    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      intent: "unknown",
      code: "AUTH_CALLBACK_TYPE_UNSUPPORTED",
    });
  });

  it("accepts an already-established recovery session without callback credentials", async () => {
    const auth = authMock();
    const result = await restoreAuthSessionFromRedirect(
      auth as never,
      new URL("https://calender.aido.co.zw/account/update-password"),
      { fallbackIntent: "recovery", sanitize: vi.fn() },
    );

    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      intent: "recovery",
      sessionEstablished: true,
    });
  });
});
