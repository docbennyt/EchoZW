import { track } from "./analytics";

export type BrowserAuthFailureCode =
  | "AUTH_CLIENT_CONFIG_MISSING"
  | "AUTH_CLIENT_INIT_FAILED"
  | "AUTH_PASSWORD_REJECTED"
  | "AUTH_RECOVERY_REQUEST_FAILED"
  | "AUTH_STAFF_SESSION_FORBIDDEN"
  | "AUTH_STAFF_SESSION_UNAVAILABLE";

export function browserAuthFailureCode(error: unknown): BrowserAuthFailureCode {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "AUTH_CLIENT_CONFIG_MISSING"
  ) {
    return "AUTH_CLIENT_CONFIG_MISSING";
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === "AUTH_CLIENT_INIT_FAILED"
  ) {
    return "AUTH_CLIENT_INIT_FAILED";
  }

  return "AUTH_CLIENT_INIT_FAILED";
}

export function trackBrowserAuthFailure(input: {
  code: BrowserAuthFailureCode;
  path?: string;
}) {
  track("auth_client_error", {
    reason: input.code,
    path: input.path ?? window.location.pathname,
  });
}
