import { googleCalendarScope } from "./googleScopes.js";

export type GoogleOAuthConfig = {
  enabled: boolean;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  clientIdSuffix: string | null;
  scope: string;
};

export function getGoogleClientIdSuffix(clientId?: string) {
  if (!clientId) return null;
  const visibleLength = Math.min(30, clientId.length);
  return clientId.slice(-visibleLength);
}

export function resolveGoogleOAuthConfig(
  env: Record<string, string | undefined>,
): GoogleOAuthConfig {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  const redirectUri = env.GOOGLE_REDIRECT_URI?.trim();

  return {
    enabled: Boolean(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
    clientIdSuffix: getGoogleClientIdSuffix(clientId),
    scope: googleCalendarScope,
  };
}

export function validateGoogleOAuthProductionConfig(
  env: Record<string, string | undefined>,
) {
  const config = resolveGoogleOAuthConfig(env);
  const googleConfigured = Boolean(
    config.clientId || config.clientSecret || config.redirectUri,
  );

  if (!googleConfigured) return config;

  const errors: string[] = [];
  if (!config.clientId) errors.push("GOOGLE_CLIENT_ID is required.");
  if (!config.clientSecret) errors.push("GOOGLE_CLIENT_SECRET is required.");
  if (!config.redirectUri) errors.push("GOOGLE_REDIRECT_URI is required.");

  if (config.redirectUri) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(config.redirectUri);
    } catch {
      errors.push("GOOGLE_REDIRECT_URI must be an absolute URL.");
    }

    if (parsed) {
      if (parsed.protocol !== "https:") {
        errors.push("GOOGLE_REDIRECT_URI must use HTTPS in production.");
      }
      if (
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname.endsWith(".localhost")
      ) {
        errors.push("GOOGLE_REDIRECT_URI cannot use localhost in production.");
      }
      if (config.redirectUri.endsWith("/")) {
        errors.push("GOOGLE_REDIRECT_URI must not have a trailing slash.");
      }
      if (parsed.pathname !== "/api/calendar/google/callback") {
        errors.push(
          "GOOGLE_REDIRECT_URI path must be /api/calendar/google/callback.",
        );
      }
      if (parsed.search || parsed.hash) {
        errors.push("GOOGLE_REDIRECT_URI must not include query or hash.");
      }
    }
  }

  if (errors.length) {
    throw new Error(errors.join(" "));
  }

  return config;
}

export function getGoogleOAuthStartupStatus(
  env: Record<string, string | undefined>,
) {
  const config = resolveGoogleOAuthConfig(env);
  return {
    enabled: config.enabled,
    redirectUri: config.redirectUri ?? null,
    clientIdSuffix: config.clientIdSuffix,
    scope: config.scope,
  };
}

export function buildGoogleAuthorizationUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
}) {
  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", input.clientId);
  authUrl.searchParams.set("redirect_uri", input.redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", googleCalendarScope);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", input.state);
  return authUrl;
}

export function buildGoogleTokenExchangeBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}) {
  return new URLSearchParams({
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
  });
}
