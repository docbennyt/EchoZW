import type { SupabaseClient } from "@supabase/supabase-js";

export const PASSWORD_RESET_PATH = "/account/update-password";
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const AUTH_CONFIRM_PATH = "/auth/confirm";
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_RESET_SENT_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";
export const PASSWORD_RESET_INVALID_MESSAGE =
  "This password reset link is no longer valid. Request a new one.";
export const INVITE_INVALID_MESSAGE =
  "We couldn't verify this CalenderZW invitation. Ask the administrator to resend it.";

export type AuthSetupIntent = "invite" | "recovery" | "unknown";

export type AuthRedirectFailureCode =
  | "AUTH_INVITE_CALLBACK_INVALID"
  | "AUTH_INVITE_SESSION_FAILED"
  | "AUTH_INVITE_VERIFICATION_FAILED"
  | "AUTH_RECOVERY_CALLBACK_INVALID"
  | "AUTH_RECOVERY_CODE_EXCHANGE_FAILED"
  | "AUTH_RECOVERY_VERIFICATION_FAILED"
  | "AUTH_SESSION_ESTABLISHMENT_FAILED"
  | "AUTH_CALLBACK_TYPE_UNSUPPORTED";

export type AuthRedirectResult =
  | {
      ok: true;
      intent: Exclude<AuthSetupIntent, "unknown">;
      sessionEstablished: true;
    }
  | {
      ok: false;
      intent: AuthSetupIntent;
      code: AuthRedirectFailureCode;
    };

const sensitiveAuthKeys = [
  "access_token",
  "refresh_token",
  "token",
  "token_hash",
  "code",
  "error",
  "error_code",
  "error_description",
  "type",
];

const allowedAuthNextPaths = new Set([
  PASSWORD_RESET_PATH,
  "/admin",
  "/account/settings",
]);

export function getPasswordResetRedirect(origin = window.location.origin) {
  return new URL(PASSWORD_RESET_PATH, origin).toString();
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`;
  }
  if (password !== confirmation) return "The passwords do not match.";
  return null;
}

export function hasAuthRedirectParameters(url: URL) {
  const haystacks = [url.searchParams, new URLSearchParams(url.hash.slice(1))];
  return haystacks.some((params) =>
    sensitiveAuthKeys.some((key) => params.has(key)),
  );
}

export function clearSensitiveAuthUrl(pathname = window.location.pathname) {
  if (!hasAuthRedirectParameters(new URL(window.location.href))) return;
  window.history.replaceState({}, "", pathname);
}

export function safeAuthNextPath(value: string | null | undefined) {
  if (!value || !allowedAuthNextPaths.has(value)) return PASSWORD_RESET_PATH;
  return value;
}

export function authSetupIntentFromUrl(
  url: URL,
  fallback: AuthSetupIntent = "unknown",
): AuthSetupIntent {
  const hash = new URLSearchParams(url.hash.slice(1));
  const candidate =
    url.searchParams.get("type") ??
    hash.get("type") ??
    url.searchParams.get("intent");
  if (candidate === "invite" || candidate === "recovery") return candidate;
  return fallback;
}

function failureForIntent(
  intent: AuthSetupIntent,
  inviteCode: AuthRedirectFailureCode,
  recoveryCode: AuthRedirectFailureCode,
): AuthRedirectResult {
  return {
    ok: false,
    intent,
    code: intent === "invite" ? inviteCode : recoveryCode,
  };
}

export async function restoreAuthSessionFromRedirect(
  auth: SupabaseClient["auth"],
  url: URL,
  options?: {
    fallbackIntent?: AuthSetupIntent;
    sanitize?: () => void;
  },
): Promise<AuthRedirectResult> {
  const hash = new URLSearchParams(url.hash.slice(1));
  const tokenHash = url.searchParams.get("token_hash");
  const code = url.searchParams.get("code");
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  const explicitType =
    url.searchParams.get("type") ?? hash.get("type") ?? undefined;
  const fallbackIntent = options?.fallbackIntent ?? "unknown";
  const intent = authSetupIntentFromUrl(url, fallbackIntent);
  const sanitize =
    options?.sanitize ?? (() => clearSensitiveAuthUrl(url.pathname));

  if (tokenHash) {
    if (explicitType !== "invite" && explicitType !== "recovery") {
      sanitize();
      return {
        ok: false,
        intent,
        code: "AUTH_CALLBACK_TYPE_UNSUPPORTED",
      };
    }
    sanitize();
    const { error } = await auth.verifyOtp({
      token_hash: tokenHash,
      type: explicitType,
    });
    if (error) {
      return failureForIntent(
        explicitType,
        "AUTH_INVITE_VERIFICATION_FAILED",
        "AUTH_RECOVERY_VERIFICATION_FAILED",
      );
    }
  } else if (code) {
    sanitize();
    const { error } = await auth.exchangeCodeForSession(code);
    if (error) {
      return {
        ok: false,
        intent: intent === "invite" ? "invite" : "recovery",
        code:
          intent === "invite"
            ? "AUTH_INVITE_VERIFICATION_FAILED"
            : "AUTH_RECOVERY_CODE_EXCHANGE_FAILED",
      };
    }
  } else if (accessToken || refreshToken) {
    sanitize();
    if (explicitType !== "invite" || !accessToken || !refreshToken) {
      return {
        ok: false,
        intent,
        code:
          explicitType && explicitType !== "invite"
            ? "AUTH_CALLBACK_TYPE_UNSUPPORTED"
            : "AUTH_INVITE_CALLBACK_INVALID",
      };
    }
    const { error } = await auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) {
      return {
        ok: false,
        intent: "invite",
        code: "AUTH_INVITE_SESSION_FAILED",
      };
    }
  } else if (hasAuthRedirectParameters(url)) {
    sanitize();
    return failureForIntent(
      intent,
      "AUTH_INVITE_CALLBACK_INVALID",
      "AUTH_RECOVERY_CALLBACK_INVALID",
    );
  }

  const { data, error } = await auth.getSession();
  if (error || !data.session) {
    if (tokenHash || code || accessToken || refreshToken) {
      return {
        ok: false,
        intent,
        code: "AUTH_SESSION_ESTABLISHMENT_FAILED",
      };
    }
    return failureForIntent(
      intent,
      "AUTH_INVITE_CALLBACK_INVALID",
      "AUTH_RECOVERY_CALLBACK_INVALID",
    );
  }

  return {
    ok: true,
    intent: intent === "invite" ? "invite" : "recovery",
    sessionEstablished: true,
  };
}
