export const PASSWORD_RESET_PATH = "/account/update-password";
export const AUTH_CALLBACK_PATH = "/auth/callback";
export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_RESET_SENT_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";
export const PASSWORD_RESET_INVALID_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one.";

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
