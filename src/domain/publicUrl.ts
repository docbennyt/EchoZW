export type PublicUrlMode = "development" | "production" | "test";
type HeaderValue = string | string[] | undefined;

function firstHeaderValue(value: HeaderValue) {
  return Array.isArray(value) ? value[0] : value;
}

function firstForwardedValue(value: string | undefined) {
  return value?.split(",")[0]?.trim();
}

function hasConfiguredPublicOrigin(env: Record<string, string | undefined>) {
  return Boolean(
    env.PUBLIC_APP_URL ?? env.VITE_PUBLIC_APP_URL ?? env.VITE_APP_BASE_URL,
  );
}

export function getPublicAppUrl(
  env: Record<string, string | undefined>,
  mode: PublicUrlMode = "development",
) {
  const raw =
    env.PUBLIC_APP_URL ??
    env.VITE_PUBLIC_APP_URL ??
    env.VITE_APP_BASE_URL ??
    (mode === "production"
      ? "https://calendar.example.com"
      : "http://localhost:5173");
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("PUBLIC_APP_URL must be a valid absolute URL.");
  }

  const isLocalhost =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname.endsWith(".localhost");
  const isPrivateLan =
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);

  if (mode === "production" && url.protocol !== "https:") {
    throw new Error("PUBLIC_APP_URL must use HTTPS in production.");
  }

  if (mode === "production" && (isLocalhost || isPrivateLan)) {
    throw new Error("PUBLIC_APP_URL must be publicly reachable in production.");
  }

  return url.origin.replace(/\/$/, "");
}

export function isExternallyFetchableUrl(value: string) {
  try {
    const url = new URL(value);
    const isLocalhost =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".localhost");
    const isPrivateLan =
      /^10\./.test(url.hostname) ||
      /^192\.168\./.test(url.hostname) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname);
    return url.protocol === "https:" && !isLocalhost && !isPrivateLan;
  } catch {
    return false;
  }
}

export function getPublicAppUrlFromHeaders(
  env: Record<string, string | undefined>,
  headers: Record<string, HeaderValue>,
  mode: PublicUrlMode = "development",
) {
  if (hasConfiguredPublicOrigin(env)) {
    return getPublicAppUrl(env, mode);
  }

  const forwardedProto = firstForwardedValue(
    firstHeaderValue(headers["x-forwarded-proto"]),
  );
  const forwardedHost = firstForwardedValue(
    firstHeaderValue(headers["x-forwarded-host"]),
  );
  const host = forwardedHost ?? firstHeaderValue(headers.host);
  const protocol = mode === "production" ? (forwardedProto ?? "https") : "http";

  if (host) {
    return getPublicAppUrl({ PUBLIC_APP_URL: `${protocol}://${host}` }, mode);
  }

  return getPublicAppUrl(env, mode);
}
