import { describe, expect, it } from "vitest";
import {
  getPasswordResetRedirect,
  hasAuthRedirectParameters,
  PASSWORD_RESET_PATH,
  PASSWORD_RESET_SENT_MESSAGE,
  validateNewPassword,
} from "../src/authRecovery";
import { BRAND } from "../src/config/brand";

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
});
