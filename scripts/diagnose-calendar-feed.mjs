import dns from "node:dns/promises";
import tls from "node:tls";

const REQUIRED_HOST = process.env.CALENDERZW_FEED_HOST ?? "calender.aido.co.zw";
const rawFeedUrl = process.env.CALENDERZW_FEED_URL ?? process.argv[2];

if (!rawFeedUrl) {
  console.error(
    "Usage: CALENDERZW_FEED_URL='https://calender.aido.co.zw/calendar/feed/<private-token>.ics' npm run calendar:diagnose",
  );
  process.exit(2);
}

let feedUrl;
try {
  feedUrl = new URL(rawFeedUrl);
} catch {
  console.error("CALENDERZW_FEED_URL must be a valid absolute URL.");
  process.exit(2);
}

const tokenMatch = feedUrl.pathname.match(/^\/calendar\/feed\/([^/]+)\.ics$/);
if (feedUrl.protocol !== "https:" || !tokenMatch) {
  console.error(
    "Feed URL must use HTTPS and match /calendar/feed/<private-token>.ics.",
  );
  process.exit(2);
}
if (feedUrl.hostname !== REQUIRED_HOST) {
  console.error(`Feed URL hostname must be ${REQUIRED_HOST}.`);
  process.exit(2);
}

const rawToken = decodeURIComponent(tokenMatch[1]);
const failures = [];

function redact(value) {
  return String(value)
    .split(rawToken)
    .join("<redacted-token>")
    .replace(/\/calendar\/feed\/[^/?#\s]+\.ics/g, "/calendar/feed/<redacted-token>.ics");
}

function report(label, value) {
  console.log(`${label}: ${redact(value)}`);
}

function fail(message) {
  failures.push(message);
  console.error(`FAIL: ${redact(message)}`);
}

async function inspectTls(url) {
  const addresses = await dns.lookup(url.hostname, { all: true });
  report(
    "DNS",
    addresses.map((entry) => `${entry.address} (IPv${entry.family})`).join(", "),
  );

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host: url.hostname,
        port: Number(url.port || 443),
        servername: url.hostname,
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
      },
      () => {
        const certificate = socket.getPeerCertificate(true);
        const result = {
          authorized: socket.authorized,
          authorizationError: socket.authorizationError,
          protocol: socket.getProtocol(),
          cipher: socket.getCipher(),
          certificate,
        };
        socket.end();
        resolve(result);
      },
    );
    socket.once("error", reject);
  });
}

async function fetchFollowingRedirects(initialUrl, method) {
  let current = new URL(initialUrl);
  const redirects = [];

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(current, {
      method,
      redirect: "manual",
      headers: {
        "User-Agent": "CalenderZW-Feed-Diagnostic/1.0",
        Accept: "text/calendar,*/*;q=0.8",
      },
    });

    if (response.status < 300 || response.status >= 400) {
      return { response, current, redirects };
    }

    const location = response.headers.get("location");
    if (!location) return { response, current, redirects };
    const next = new URL(location, current);
    redirects.push({ status: response.status, from: current, to: next });
    if (next.protocol !== "https:") {
      fail(`Redirect downgraded HTTPS to ${next.protocol}`);
    }
    if (next.hostname !== REQUIRED_HOST) {
      fail(`Redirect changed hostname to ${next.hostname}`);
    }
    current = next;
  }

  throw new Error("Too many redirects while checking calendar feed.");
}

try {
  console.log("CalenderZW private calendar feed diagnostic");
  report("Target", feedUrl.toString());

  const tlsResult = await inspectTls(feedUrl);
  report("TLS authorized", tlsResult.authorized);
  report("TLS protocol", tlsResult.protocol ?? "unknown");
  report("Cipher", tlsResult.cipher?.name ?? "unknown");
  report("Certificate subject", JSON.stringify(tlsResult.certificate?.subject ?? {}));
  report("Certificate issuer", JSON.stringify(tlsResult.certificate?.issuer ?? {}));
  report("Certificate valid from", tlsResult.certificate?.valid_from ?? "unknown");
  report("Certificate valid to", tlsResult.certificate?.valid_to ?? "unknown");
  report("Certificate SAN", tlsResult.certificate?.subjectaltname ?? "unknown");
  report("Certificate fingerprint", tlsResult.certificate?.fingerprint256 ?? "unknown");
  if (!tlsResult.authorized) {
    fail(`TLS certificate is not trusted: ${tlsResult.authorizationError ?? "unknown"}`);
  }
  if (!tlsResult.certificate?.subjectaltname?.includes(REQUIRED_HOST)) {
    fail("Certificate SAN does not contain the production feed hostname.");
  }

  const head = await fetchFollowingRedirects(feedUrl, "HEAD");
  report("HEAD status", head.response.status);
  report("HEAD final URL", head.current.toString());
  report("HEAD redirects", JSON.stringify(head.redirects));
  report("HEAD Content-Type", head.response.headers.get("content-type") ?? "missing");
  report("HEAD ETag", head.response.headers.get("etag") ?? "missing");
  report("HEAD Last-Modified", head.response.headers.get("last-modified") ?? "missing");
  if (head.response.status !== 200) fail(`HEAD returned ${head.response.status}, expected 200.`);

  const get = await fetchFollowingRedirects(feedUrl, "GET");
  const body = await get.response.text();
  report("GET status", get.response.status);
  report("GET final URL", get.current.toString());
  report("GET redirects", JSON.stringify(get.redirects));
  report("GET Content-Type", get.response.headers.get("content-type") ?? "missing");
  report("GET Cache-Control", get.response.headers.get("cache-control") ?? "missing");
  report("GET X-Robots-Tag", get.response.headers.get("x-robots-tag") ?? "missing");

  if (get.response.status !== 200) fail(`GET returned ${get.response.status}, expected 200.`);
  if (!/^text\/calendar(?:;|$)/i.test(get.response.headers.get("content-type") ?? "")) {
    fail("GET Content-Type is not text/calendar.");
  }
  if (!body.startsWith("BEGIN:VCALENDAR\r\n")) {
    fail("Feed body does not start with a CRLF-delimited VCALENDAR.");
  }
  if (/<html|<!doctype|application\/json/i.test(body.slice(0, 500))) {
    fail("Feed body looks like HTML or JSON instead of an ICS calendar.");
  }

  const safeLines = body
    .split(/\r\n/)
    .filter((line) => !/^DESCRIPTION:/i.test(line))
    .slice(0, 16);
  console.log("Safe ICS prefix:");
  for (const line of safeLines) report("  ", line);

  const etag = get.response.headers.get("etag");
  if (etag) {
    const conditional = await fetch(feedUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        "If-None-Match": etag,
        "User-Agent": "CalenderZW-Feed-Diagnostic/1.0",
      },
    });
    report("Conditional GET status", conditional.status);
    if (conditional.status !== 304) {
      fail(`Conditional GET returned ${conditional.status}, expected 304.`);
    }
  } else {
    fail("Feed did not return an ETag.");
  }

  const invalidUrl = new URL(feedUrl);
  invalidUrl.pathname = "/calendar/feed/calenderzw-diagnostic-invalid-token.ics";
  const invalid = await fetch(invalidUrl, { redirect: "manual" });
  report("Invalid token status", invalid.status);
  if (invalid.status !== 404) {
    fail(`Invalid token returned ${invalid.status}, expected 404.`);
  }

  if (failures.length > 0) {
    console.error(`Diagnostic failed with ${failures.length} issue(s).`);
    process.exit(1);
  }

  console.log("PASS: production feed transport and HTTP checks passed.");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
