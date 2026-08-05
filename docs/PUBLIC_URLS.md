# Public URLs

Use `PUBLIC_APP_URL` as the canonical public origin. In Vite client code, expose the same value as `VITE_PUBLIC_APP_URL`.

Rules:

- trim trailing slashes;
- validate as an absolute URL;
- require HTTPS in production;
- reject localhost, `127.0.0.1`, and private LAN addresses in production;
- allow localhost only for direct browser testing.

Why the Google Calendar paste failed:

`http://localhost:5173/calendar/feed/...` points to your own machine. Google Calendar's servers cannot fetch it. Before this change, the Vite SPA also returned HTML for that route unless the new dev middleware handled it.

For real provider testing, use:

- a public HTTPS preview deployment;
- a public HTTPS tunnel;
- or production hosting.

Subscribed feeds do not refresh immediately in every calendar client. Google API sync is the immediate-update path after publication.
