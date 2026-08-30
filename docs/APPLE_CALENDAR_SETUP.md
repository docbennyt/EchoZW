# Apple Calendar Setup

Apple Calendar subscriptions use a private, read-only HTTPS calendar feed. The canonical subscription identity is always the secure web address returned by CalenderZW:

`https://calender.aido.co.zw/calendar/feed/<private-token>.ics`

The feed URL is a bearer credential. Treat it like a secret: do not post it in class groups, analytics, screenshots, event descriptions, or public pages. Share the public class link instead: `/t/:slug`.

## Recommended iPhone flow

1. Open the class timetable at `/t/:slug`.
2. Tap **Subscribe to calendar**.
3. Choose a reminder preset.
4. Choose **Apple Calendar**.
5. CalenderZW creates a private HTTPS feed.
6. Tap **Open Apple Calendar** if the optional `webcal://` convenience link works on that iOS version.
7. If it does not, tap **Copy secure subscription URL**, then in Calendar choose **Calendars → Add Calendar → Add Subscription Calendar**, paste the HTTPS URL, and tap **Find**.

`webcal://` is only an optional deep link derived from the HTTPS feed. It is never the canonical stored subscription URL. Never generate `webcal://https://...`, `webcals://...`, or localhost subscription URLs.

## One-time .ics fallback

**Download one-time .ics** imports the current published timetable once. It is not a subscription and will not receive future CalenderZW publications. The UI must never describe a downloaded `.ics` file as live sync.

## Timezone semantics

The institution IANA timezone is authoritative. For HIT the machine timezone is `Africa/Harare`.

Example:

- lecture wall-clock time: `08:00 Africa/Harare`
- equivalent UTC instant: `06:00Z`

The event remains an 08:00 university lecture. A calendar client configured to display `GMT+00` may legitimately show the equivalent 06:00 instant. Do not fix that by adding two hours to `DTSTART` or by serializing `08:00Z`.

Reminder choices are emitted as `VALARM` entries only. A 30-minute reminder for an 08:00 lecture means an alarm at 07:30; it must never alter the event's `DTSTART` or `DTEND`.

## If iPhone says “Validation failed”

Check the canonical HTTPS feed directly before changing UI code:

1. URL begins with `https://calender.aido.co.zw/calendar/feed/`.
2. The token has not been truncated, edited, or copied with surrounding punctuation.
3. The endpoint returns HTTP 200 for GET and HEAD.
4. `Content-Type` is `text/calendar; charset=utf-8`.
5. The response body begins with a valid `VCALENDAR` and is not HTML or JSON.
6. The feed is reachable without cookies, login, JavaScript, or an Authorization header.
7. The route resolves the current published timetable version and does not fall through to the SPA shell.

## If iPhone says “Insecure Connection”

Treat this as a transport/TLS investigation, not an ICS timezone problem. Verify:

1. the feed URL is HTTPS from the first request;
2. there is no HTTPS → HTTP redirect;
3. the certificate SAN includes `calender.aido.co.zw`;
4. the certificate is in its validity window;
5. the full certificate chain is trusted and intermediates are present;
6. TLS 1.2 or newer is negotiated;
7. reverse-proxy routing keeps `/calendar/feed/*.ics` on the production Node server;
8. no EasyPanel/proxy challenge, login page, or browser-specific interstitial is injected;
9. GET returns `text/calendar`, not SPA HTML or a JSON error;
10. the feed remains accessible without browser cookies.

Use the repository diagnostic after deployment with a fresh private feed URL:

`npm run calendar:diagnose -- "https://calender.aido.co.zw/calendar/feed/<private-token>.ics"`

The diagnostic redacts the private token in its report and checks DNS, TLS/certificate metadata, redirects, HEAD, GET, calendar content type, ETag/304 behavior, privacy headers, and invalid-token handling.

If the diagnostic proves the repository endpoint is correct but iPhone still reports an insecure connection, inspect the production TLS terminator / EasyPanel reverse proxy. React code cannot repair a broken certificate chain or HTTP downgrade.

## Refresh semantics

A subscription feed resolves the timetable's current published version when the calendar client fetches it. A republished logical session keeps the same UID when its `stable_session_key` is unchanged and uses a higher `SEQUENCE` for the newer publication.

CalenderZW can make updated feed data available immediately after publication, but Apple controls when its client next refreshes a subscribed calendar. Do not promise a specific Apple refresh interval.
