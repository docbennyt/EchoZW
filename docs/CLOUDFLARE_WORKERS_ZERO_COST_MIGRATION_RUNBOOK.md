# CalenderZW Cloudflare Workers Zero-Cost Migration Runbook

> Status: **planning only — do not migrate production from this document alone**
>
> Last reviewed: **2026-09-29**
>
> Purpose: make a future Vercel + Railway -> Cloudflare migration fast, reversible, measurable, and boring for users.

---

## 1. Executive decision

CalenderZW can target a **$0/month infrastructure bill** without moving the database away from Supabase.

The lowest-risk target architecture is:

```text
Internet
   |
   v
Cloudflare DNS / TLS
   |
   v
Cloudflare Worker on https://calender.aido.co.zw
   |\
   | \-- static SPA assets (Vite dist; free/unlimited static asset requests)
   |
   |---- /api/*, /runtime-config.js, /sitemap.xml, OAuth callbacks,
   |     calendar feeds, admin APIs, source-ingestion APIs
   |
   +---- Supabase Postgres + Auth (keep existing production database)
   |
   +---- Cloudflare R2 for private raw timetable source objects
   |
   +---- Cloudflare Queues / scheduled handlers where event processing is needed

No Railway runtime is required after cutover.
No Vercel runtime is required after cutover.
Supabase remains the relational database/auth platform for the first migration.
```

### Why this is the recommended first migration

**Do not combine a hosting migration with a database-engine migration.** CalenderZW currently depends on Supabase/Postgres behavior, privileged server access, authorization contracts, schema-compatibility checks, migrations, and existing production data. Replacing Railway with Workers is already a runtime model change. Replacing Postgres with D1 in the same event would simultaneously change SQL semantics, authorization/RLS assumptions, stored functions/RPCs, migrations, transactions, and operational recovery.

The first Cloudflare cutover should therefore preserve the production data plane:

- keep **Supabase Postgres**;
- keep **Supabase Auth**;
- keep existing schema and migrations unchanged;
- move the **Node HTTP runtime** to a Worker-compatible request handler;
- move **frontend static assets** from Vercel to Cloudflare static assets;
- keep/use **R2** for private raw timetable source files;
- refactor long-running polling into event-driven or scheduled Worker execution.

D1 can be evaluated later as a **separate migration project**, not as a prerequisite for reaching $0.

---

## 2. $0 is a capacity target, not a promise based on subscriber count

“50,000 subscribers” does **not** by itself prove the stack will remain free. Free tiers are metered by requests, CPU, database size, egress, MAU, storage operations, queue operations, etc.

As of 2026-09-29, re-check the official pricing pages immediately before migration because limits can change.

### Current free-tier planning limits

| Service | Free allowance relevant to CalenderZW | Migration implication |
|---|---:|---|
| Cloudflare Workers | 100,000 dynamic Worker requests/day; 10 ms CPU/invocation | Dynamic API traffic must fit the budget; static assets do not consume this request quota. Heavy DOCX parsing must be benchmarked. |
| Worker Static Assets | Static asset requests are free and unlimited | Ideal for the Vite frontend. Keep API paths separate from asset paths. |
| Cloudflare R2 Standard | 10 GB-month storage/month; 1M Class A ops/month; 10M Class B ops/month; Internet egress free | Suitable for private timetable source documents while within limits. |
| Cloudflare Queues | 10,000 operations/day on Workers Free | Queue use must be budgeted; a normal message lifecycle can consume write + read + delete operations. |
| Supabase Free | 50,000 MAU; 500 MB database/project; 5 GB egress; other product-specific quotas | At exactly 50k MAU there is no safety margin. Database size and egress may become the earlier constraint. |

Official references to re-check:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/queues/platform/pricing/
- https://supabase.com/docs/guides/platform/billing-on-supabase

### Required financial gate before cutover

Measure at least 7 representative production days and record:

- total requests/day to Railway;
- requests/day by endpoint group;
- p50/p95/p99 Worker-equivalent CPU time for each endpoint;
- Supabase MAU;
- Supabase DB size;
- Supabase egress/day and month-to-date;
- R2 stored GB;
- R2 Class A/B operations;
- push deliveries/day;
- source-processing jobs/day;
- timetable public/API reads/day;
- calendar feed hits/day;
- Google OAuth callback count/day.

### Zero-cost guardrails

Do not call the target “safely free” unless all of these have margin:

```text
Workers dynamic requests <= 70,000/day sustained
Workers p95 CPU <= 8 ms for normal endpoints
Supabase MAU <= 40,000/month during the migration window
Supabase DB <= 400 MB
Supabase egress projected <= 4 GB/month
R2 Standard storage <= 8 GB-month
R2 Class A <= 800k/month
R2 Class B <= 8M/month
Queues <= 8k operations/day
```

Those are **operational warning thresholds**, not provider limits. They deliberately leave headroom.

If production traffic exceeds the free limits, do not degrade UX or reliability merely to preserve a “$0” badge. The correct decision is then to optimize usage or accept a small paid tier.

---

## 3. Current production topology and the coupling we must remove

The repository currently documents this production shape:

```text
Browser
  |
  v
Vercel: https://calender.aido.co.zw
  |   serves Vite dist
  |   rewrites /api/*
  |   rewrites /runtime-config.js
  |   rewrites /sitemap.xml
  v
Railway: Node productionServer
  |
  +--> Supabase
  +--> Google Calendar
  +--> PesePay (when enabled)
  +--> Web Push
  +--> source processing
```

Important provider assumptions currently encoded in the repository include:

1. `vercel.json` rewrites `/api/:path*`, `/runtime-config.js`, and `/sitemap.xml` to `https://calender.up.railway.app`.
2. `server/productionServer.ts` owns both backend routes and static-file/SPA serving behavior.
3. `runtimePublicConfig.ts` looks for Railway/Vercel-style release SHA variables.
4. production startup assumes a long-lived Node process that listens on a TCP port.
5. source processing runs via a perpetual timer loop.
6. push delivery runs via a perpetual timer loop.
7. `.env.example` assumes Vercel public frontend + Railway backend and a same-origin rewrite bridge.
8. `CALENDAR_STORE_PATH=/data/...` indicates a filesystem persistence contract that must be traced and eliminated/replaced before Workers.
9. Railway currently injects `PORT`; Workers do not use this model.

A migration is not complete while any production-critical behavior silently depends on one of these assumptions.

---

## 4. Previous provider-move risk areas — migration invariants

The VPS -> Railway/Vercel move exposed exactly the class of issues this runbook is designed to prevent. Treat the following as **non-negotiable migration invariants**.

### 4.1 One public origin must behave as one application

Users should only need:

```text
https://calender.aido.co.zw
```

The migration must not leak infrastructure hostnames into normal browser flows.

Keep browser traffic same-origin wherever possible:

- `/api/*`
- `/runtime-config.js`
- `/sitemap.xml`
- `/api/calendar/google/callback`
- calendar feed routes
- public timetable routes

This prevents proxy/CORS/origin inconsistencies.

### 4.2 Deep links must never become provider 404s

The SPA must work when loaded directly at routes such as:

- `/admin`
- `/admin/static-import`
- `/login`
- `/t/<slug>`
- Class Rep routes
- legal pages
- timetable discovery pages

Unknown **frontend** routes should receive the SPA shell. Unknown **API** routes must remain JSON 404s and must never receive `index.html`.

### 4.3 Runtime config must stay runtime config

`/runtime-config.js` currently carries browser-safe production values and is intentionally `no-store`.

Preserve these invariants:

- generated at runtime;
- no privileged Supabase key;
- no Google client secret;
- no push private key;
- no OAuth token;
- no calendar token secret;
- no storage credential;
- `Cache-Control: no-store`;
- content is environment-correct before the SPA boots.

### 4.4 Never cache authenticated or dynamic API responses by accident

The Vercel configuration explicitly disables rewrite caching for dynamic backend traffic. Cloudflare introduces a powerful CDN cache, so the migration must prove that protected/dynamic API responses are **not** cached unless an endpoint is explicitly designed for public caching.

Default policy:

```text
/api/admin/*                      no-store
/api/* authenticated             no-store
/runtime-config.js                no-store
OAuth callbacks                   no-store
payment callbacks                 no-store
private timetable/session data    no-store
public immutable assets           1 year immutable
public HTML shell                 short cache / revalidate
public timetable JSON             explicit conservative cache only if safe
sitemap.xml                       explicit bounded cache
```

### 4.5 Production secrets stay server-side

Worker secrets must be configured with Cloudflare secret bindings, not committed into `wrangler.jsonc`, Vite variables, browser bundles, source maps, runtime config, logs, or responses.

### 4.6 Preserve release identity

The application currently records a release SHA. Add Cloudflare release metadata so support can answer:

> Which exact commit served this broken request?

Every deployment must expose/log an immutable Git SHA or equivalent build identifier.

---

## 5. Runtime conversion strategy

### 5.1 Do not try to “host the existing Node server inside Workers” unchanged

The current production entrypoint does all of these Node-server tasks:

- `createServer(...)`;
- `server.listen(...)`;
- local filesystem `stat/readFile/createReadStream`;
- signal handling (`SIGTERM`, `SIGINT`);
- perpetual background worker startup;
- explicit TCP-port ownership.

Workers use an event/request model. The correct migration is to extract the provider-neutral request logic and place a thin runtime adapter around it.

Target structure:

```text
server/
  app/
    handleRequest.ts          # provider-neutral Request -> Response
    routes/*                  # route adapters/domain calls
  node/
    productionServer.ts       # temporary Railway adapter during migration
  cloudflare/
    worker.ts                 # fetch/scheduled/queue entrypoint
```

The Railway Node adapter and Cloudflare Worker adapter should temporarily call the **same core request logic**. This allows differential testing before cutover.

### 5.2 Use Web-standard request/response interfaces internally

Prefer:

```ts
handleRequest(request: Request, env: AppEnv, ctx: ExecutionContext): Promise<Response>
```

Do not let domain handlers depend on:

```ts
IncomingMessage
ServerResponse
process.env
local filesystem
server.listen
```

Use an explicit typed environment object.

### 5.3 Node compatibility is helpful, not an excuse to keep process assumptions

Cloudflare Workers now support a broad Node.js compatibility surface for recent compatibility dates. That helps packages using `node:crypto`, streams, HTTP client APIs, etc.

It does **not** make long-lived process architecture, writable local disk, port listeners, or perpetual polling a sound Worker design.

Set a recent compatibility date and use the latest Wrangler/Cloudflare Vite plugin at migration time. Test every server-only dependency in a real Worker preview.

---

## 6. Frontend migration: Vercel -> Cloudflare static assets

### Target

One Worker deployment should contain the Vite static output and the API runtime.

Benefits:

- removes Vercel as an availability dependency;
- removes Vercel -> Railway rewrite coupling;
- `/api/*` becomes genuinely same-origin;
- static asset requests do not consume the Worker dynamic request quota;
- custom domain, TLS, cache behavior, API and frontend release can move atomically.

### Requirements

1. Build remains `npm run build` or an equivalent deterministic command.
2. Vite output stays `dist/`.
3. hashed `/assets/*` files receive immutable caching.
4. `index.html` must not be cached indefinitely.
5. route precedence must be explicit:

```text
/api/*              -> Worker API
/runtime-config.js  -> Worker runtime config
/sitemap.xml        -> Worker SEO handler
other real asset    -> static asset
frontend deep link  -> SPA shell / SEO-rendered shell
```

6. preserve legacy redirects:

```text
/dashboard          -> /admin
/dashboard/*        -> /admin/*
/sync/:slug         -> /t/:slug
```

7. preserve current SEO behavior for shareable/public timetable routes.
8. ensure asset-origin checks detect accidental references to `vercel.app`, `railway.app`, old VPS addresses, localhost, or preview hosts.

---

## 7. Database and auth: keep Supabase for the first migration

### Why

The existing server configuration has both:

- browser-safe Supabase URL/publishable key;
- privileged server key for admin/server authorization.

Preserving Supabase means the migration does **not** have to reinvent:

- existing identities;
- sessions;
- password/recovery flows;
- RLS behavior;
- Postgres constraints;
- migrations;
- RPC/functions;
- production data;
- admin authorization contracts.

### Worker/Supabase rules

- browser-safe publishable credentials remain public;
- privileged key exists only as a Worker secret;
- do not embed privileged keys in static assets;
- keep all existing backend admin authorization checks;
- keep RLS as defense-in-depth;
- use HTTPS Supabase APIs unless a specific database connection path has been proven safe/necessary;
- instrument Supabase latency separately from Worker latency;
- time out external calls and return controlled errors;
- never log access tokens or privileged keys.

### D1 decision

**Not part of this migration.**

A later Supabase Postgres -> D1 project must explicitly replace/verify:

- PostgreSQL-specific SQL;
- RLS;
- RPC/stored procedures;
- triggers;
- transactional behavior;
- extensions;
- migration tooling;
- Auth-to-data authorization semantics;
- backup/PITR expectations;
- admin/service-role behavior.

D1’s free tier can be attractive, but this should be justified by measured Supabase limits/cost, not merged into a hosting cutover.

---

## 8. Private source documents: R2 remains the object-store target

CalenderZW’s static timetable import architecture already requires private Cloudflare R2 for raw timetable source documents, with Supabase storing structured metadata/review/version state.

Preserve:

```text
raw DOCX bytes        -> private R2
metadata/provenance   -> Supabase Postgres
browser direct access -> NO
admin evidence read   -> short-lived authorized path/signed URL
```

On Workers, prefer native R2 bindings where practical instead of shipping an S3 SDK merely to call the same Cloudflare account.

Keep the source-object-store abstraction so the business logic remains provider-independent.

### Required R2 tests

- private bucket only;
- content-addressed key remains deterministic;
- duplicate bytes do not duplicate logical source state;
- no credential in API responses;
- no signed URL in logs;
- upload size limit still enforced;
- malformed DOCX fails closed;
- source evidence remains downloadable by authorized admins;
- legacy source rows remain readable.

---

## 9. Background processing: the biggest runtime redesign

The current Node server starts two perpetual polling loops:

```text
source-processing worker: ~15 second poll
push-notification worker:  ~10 second poll
```

That model must not be copied directly into Workers.

### 9.1 Source processing

Preferred future flow:

```text
API receives source/snapshot event
        |
        v
persist authoritative job in Supabase
        |
        +--> enqueue compact job message
                 |
                 v
          Queue consumer / explicit processing invocation
                 |
                 v
          claim job transactionally
                 |
                 v
          process exactly once logically
                 |
                 v
          persist success/failure
```

The database remains the idempotency authority. A queue provides delivery, not business truth.

If Queues free limits are too small, a scheduled Worker may claim bounded batches from Supabase, but do **not** promise 10–15 second polling latency on a free Cron design.

### 9.2 Web Push

Current code uses `web-push` plus a polling outbox worker.

Migration requirements:

- compatibility-test the `web-push` package in Cloudflare’s actual runtime;
- verify VAPID signing and outbound HTTPS in production preview;
- do not assume “Node compatibility” proves library compatibility;
- trigger delivery from queue/event processing rather than a permanent timer;
- preserve retry classification;
- preserve delivery idempotency;
- preserve topic/TTL behavior;
- keep private VAPID key secret;
- load-test fan-out while respecting Worker CPU and queue limits.

### 9.3 Free-tier CPU warning

Workers Free currently budgets **10 ms CPU per invocation**. Heavy deterministic DOCX ZIP/XML parsing, large reconciliation jobs, crypto-heavy operations, or large push batches may exceed that.

Before declaring the migration feasible at $0, benchmark these exact production workloads in a deployed Worker:

- real Biotechnology DOCX parse;
- source reconciliation;
- large timetable materialization;
- push batch of 1/10/100;
- public timetable generation;
- calendar feed generation;
- admin analytics endpoints.

Gate:

```text
normal API p95 <= 8 ms CPU
heavy operation either <= 8 ms CPU OR decomposed into safe bounded steps
```

If the real parser consistently exceeds the free CPU budget, document it as a factual blocker. Do not weaken validation, silently truncate work, or shift security-sensitive parsing into the browser just to claim $0.

---

## 10. Filesystem audit — required before Workers

Workers must not rely on Railway/VPS-style durable local files.

The current environment template contains:

```text
CALENDAR_STORE_PATH=/data/calenderzw-calendar-store.json
```

Before migration:

1. locate every read/write of `CALENDAR_STORE_PATH`;
2. determine whether it is legacy, fallback, test-only, or production-authoritative;
3. migrate any authoritative state to Supabase/Postgres or an appropriate Cloudflare storage primitive;
4. remove production dependence on local disk;
5. add a test that fails if the Worker path attempts filesystem persistence.

Do not replace relational truth with KV merely because KV is available. Use storage based on consistency needs.

---

## 11. Environment-variable translation

Create a checked migration manifest before touching production.

### Public/browser-safe

Examples:

- `VITE_PUBLIC_APP_URL`
- `VITE_APP_BASE_URL`
- `VITE_SUPPORT_EMAIL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- browser feature flags
- public legal presentation values

### Server secrets / Worker secrets

Examples:

- `SUPABASE_SECRET_KEY`
- legacy `SUPABASE_SERVICE_ROLE_KEY` if still needed
- `GOOGLE_CLIENT_SECRET`
- `CALENDAR_TOKEN_HASH_SECRET`
- `TOKEN_ENCRYPTION_KEY`
- `HIT_TIMETABLE_RELAY_SECRET`
- PesePay secrets
- `WEB_PUSH_VAPID_PRIVATE_KEY`
- any R2 compatibility credentials if the native binding is not used

### Runtime-only non-secret configuration

Examples:

- `PUBLIC_APP_URL=https://calender.aido.co.zw`
- `APP_ENV=production`
- Google redirect URI
- feature enablement switches
- legal operator data
- push subject/public key

### Variables that must disappear or be redesigned

- `PORT`
- Railway-only environment metadata
- Railway git SHA lookup as the sole release source
- filesystem store paths used as production persistence
- polling interval settings where queue/event processing replaces loops

Create `docs/cloudflare-env-mapping.md` during implementation with columns:

```text
Old name | New binding/name | Secret? | Required? | Validation | Owner | Rotated during cutover?
```

---

## 12. OAuth, callbacks, external integrations

### Google Calendar

The callback must remain exactly on the public application origin unless intentionally re-registered:

```text
https://calender.aido.co.zw/api/calendar/google/callback
```

Before cutover verify:

- Google Console authorized redirect URI;
- OAuth state/nonce validation;
- callback route precedence before SPA fallback;
- token encryption/decryption;
- refresh-token persistence;
- reconnect flow;
- revoked-grant handling;
- account mismatch handling;
- mobile browser redirect flow;
- no infrastructure hostname appears in browser-visible redirects.

### PesePay

If enabled at cutover, verify:

- return URL;
- result/webhook URL;
- signature/secret validation;
- retry idempotency;
- duplicate callback handling;
- non-2xx retry semantics;
- Worker body parsing does not alter signed payloads.

If not enabled, keep it explicitly disabled and test that disabled behavior.

### HIT timetable relay/source gateway

Verify:

- secret validation;
- body size limits;
- replay/idempotency protection;
- static-document vs live-source authority rules;
- source processing still claims work exactly once logically.

---

## 13. Security invariants

Every one must be tested on the Worker preview and production candidate.

### Headers

Preserve or intentionally improve:

- `X-Content-Type-Options: nosniff`
- anti-framing policy (`X-Frame-Options` and/or CSP `frame-ancestors`)
- `Referrer-Policy: strict-origin-when-cross-origin`
- restrictive `Permissions-Policy`
- HSTS on the final HTTPS custom domain

### AuthN/AuthZ

Test:

```text
anonymous -> protected admin endpoint = 401/403
ordinary authenticated user -> admin = 403
Class Rep -> allowed only for assigned class-rep operations
Admin -> admin operations allowed
Founder/admin authority unchanged
expired session -> controlled re-authentication
malformed bearer token -> 401, never 500
```

### Secret leak tests

Fail the build if browser bundles/runtime config contain markers such as:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY
GOOGLE_CLIENT_SECRET
WEB_PUSH_VAPID_PRIVATE_KEY
TOKEN_ENCRYPTION_KEY
CALENDAR_TOKEN_HASH_SECRET
R2 secret credentials
```

### Request/path handling

Re-test:

- encoded slashes;
- `..` path attempts;
- duplicate query params;
- oversized headers;
- oversized bodies;
- invalid UTF-8/encoding edge cases;
- unsupported methods;
- HEAD behavior;
- CORS preflight if any cross-origin route remains.

---

## 14. Observability must survive the migration

Railway logs currently make it possible to inspect startup/request behavior. Workers must provide equivalent or better operational evidence.

Every request log should include, without sensitive data:

```text
requestId
route class
method
status
duration
release SHA
deployment environment
Supabase dependency outcome when relevant
external integration outcome code when relevant
```

Do not log:

- bearer tokens;
- cookies;
- OAuth tokens;
- signed R2 URLs;
- VAPID private key;
- Google secret;
- Supabase privileged key;
- timetable private tokens.

### Required production health routes

Preserve:

- liveness/health route;
- readiness route;
- schema compatibility signal.

Readiness must remain a **deployment signal**, not a global frontend kill-switch. Static/login/public shells must remain available during a transient dependency failure.

---

## 15. Complete UX / quality acceptance matrix

The migration is not accepted because “the homepage loads.”

For every flow below assess:

- **Functionality** — does it produce the correct result?
- **Reliability** — retries, partial failures, race conditions, refreshes, reconnects.
- **Enjoyability** — speed, feedback, no flicker, no jarring provider errors.
- **Usefulness** — does the result help the person complete the task?
- **Equitability** — works on lower-end devices, slower networks, mobile screens, keyboard/screen reader; no flow assumes expensive hardware/bandwidth.
- **Usability** — understandable labels, visible controls, clear errors, safe defaults.

### 15.1 Anonymous visitor

Test desktop + mobile, light + dark:

- homepage;
- navigation;
- timetable discovery;
- direct timetable deep link;
- privacy;
- terms;
- contact/support;
- 404;
- offline/poor connection;
- JavaScript slow-load;
- first-load cache miss;
- repeat load.

### 15.2 Public timetable user

Test:

- valid public slug;
- invalid slug;
- archived/unpublished timetable;
- current published version;
- refresh during publication change;
- correct weekday/time/venue/course/lecturer;
- calendar subscription links;
- ICS content type and filename;
- timezone correctness;
- mobile readability;
- share/social/SEO metadata;
- stale-cache resistance after timetable update.

### 15.3 Authentication

Test:

- login;
- logout;
- expired token;
- refresh token;
- password recovery if enabled;
- direct navigation to protected route;
- open protected route in a new tab;
- browser back/forward;
- session persistence after deployment;
- role change while session exists.

### 15.4 Class Rep

This is a critical regression lane.

Test:

- Class Rep never sees legacy admin/dashboard surface;
- only the new Class Rep dashboard loads;
- add recurring class;
- modal Save button always visible;
- Save produces visible pending/success/error feedback;
- recurring class appears without hard refresh;
- edit;
- duplicate;
- delete/remove;
- undo if supported;
- idempotent double-click/retry;
- stale-edit conflict;
- duplicate-session prevention;
- mobile modal scrolling;
- keyboard access;
- light-mode input borders visible;
- dark-mode contrast correct.

### 15.5 Admin

Test:

- admin login/session;
- overview;
- analytics;
- institutions;
- programmes;
- class groups;
- academic periods;
- timetables;
- source gateway;
- static import;
- guarded publication;
- corrections;
- dark mode;
- light mode;
- input/focus/disabled/error borders;
- tables on mobile/narrow desktop;
- destructive confirmation flows.

### 15.6 Static DOCX import

Use the real acceptance source.

Verify:

- upload;
- hash;
- private R2 persistence;
- deterministic parse;
- 14 session canary;
- 6 course-reference rows;
- ICS 1110 is not silently replaced;
- SBT 1104 stays separately visible;
- blended/online raw evidence preserved;
- warnings shown;
- canonical mapping review;
- blocking warning prevents draft;
- review resolution;
- draft creation;
- published timetable not mutated during import;
- source evidence can be opened by authorized admin;
- duplicate upload idempotency;
- concurrent duplicate upload.

### 15.7 Google Calendar

Test:

- connect;
- callback;
- state verification;
- refresh token;
- calendar creation/update;
- duplicate prevention;
- disconnect/revoke;
- callback on mobile;
- callback after stale tab;
- external provider error.

### 15.8 Web Push

Test:

- subscribe;
- permission denied;
- permission later enabled;
- expired subscription;
- 404/410 subscription cleanup;
- transient provider failure;
- retry;
- duplicate outbox prevention;
- correct timetable event content;
- batch delivery behavior.

### 15.9 Payments (when enabled)

Test:

- checkout creation;
- redirect;
- successful result;
- failed/cancelled result;
- duplicate webhook;
- delayed webhook;
- forged webhook;
- refresh on result page;
- network loss during redirect.

### 15.10 Accessibility and equitable UX

At minimum:

- keyboard-only navigation;
- visible focus rings;
- semantic labels;
- screen-reader names for icon buttons;
- contrast in both themes;
- 200% zoom;
- small Android viewport;
- iOS Safari viewport;
- reduced motion;
- slow 3G simulation;
- high latency to Supabase;
- no essential information communicated by color alone;
- touch targets large enough for mobile use.

### 15.11 Performance

Record before vs after:

- TTFB;
- LCP;
- INP;
- CLS;
- JS transferred;
- API p50/p95 latency;
- Supabase p50/p95 dependency latency;
- Worker CPU p50/p95;
- cold-start behavior;
- mobile low-end profile.

Migration must not regress user-perceived performance without a documented reason.

---

## 16. Automated gates to add before cutover

Keep existing gates:

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
```

Add Cloudflare-specific gates:

```text
wrangler deploy --dry-run / build validation
Worker bundle secret scan
Worker bundle size check
Miniflare/Workers Vitest integration suite
preview smoke against actual Cloudflare preview deployment
static asset origin scan
API route parity suite
cache-header suite
redirect suite
OAuth callback route suite
```

### Differential parity test

Before production cutover, run the same safe read requests against:

```text
A = current Vercel/Railway production
B = Cloudflare preview candidate
```

Compare:

- status;
- content type;
- JSON shape;
- selected semantic fields;
- redirects;
- cache headers;
- security headers.

Do not byte-compare values that are intentionally dynamic (request IDs, timestamps, signed URLs).

---

## 17. Existing production readiness smoke must be preserved and expanded

The repository already checks:

- `/api/health/ready`;
- `/api/public/timetables/:slug`;
- `/api/admin/session`.

Keep that script working against the public origin.

Expand it before Cloudflare cutover to include:

```text
/runtime-config.js
/sitemap.xml
/
/admin deep link
/t/<known slug> deep link
legacy /dashboard redirect
legacy /sync/<slug> redirect
ICS/calendar feed canary
security headers
cache headers
release SHA
```

Run it against preview, canary production route, and final public origin.

---

## 18. Migration implementation phases

### Phase 0 — evidence capture, no code behavior change

Create a migration issue/epic and attach:

- current architecture diagram;
- last 7 days request counts;
- Supabase quotas;
- Railway env variable names (not values);
- Vercel env variable names;
- current DNS records;
- Google OAuth redirect settings;
- PesePay callback settings;
- R2 buckets/bindings;
- Worker/queue budget estimate;
- current production smoke output.

### Phase 1 — provider-neutral server core

Refactor Node handlers behind `Request -> Response` without changing behavior.

Acceptance:

- Railway production adapter still passes all tests;
- no user-visible behavior change;
- no database migration required.

### Phase 2 — Cloudflare adapter

Add:

- Wrangler config;
- Worker entrypoint;
- static asset binding;
- secret/binding types;
- release metadata;
- Cloudflare-specific health metadata;
- queue/scheduled entrypoints as required.

### Phase 3 — eliminate long-running process assumptions

Refactor:

- source polling;
- push polling;
- local filesystem persistence;
- signal/port lifecycle assumptions.

### Phase 4 — preview validation

Deploy a non-production Cloudflare preview.

No production DNS change.

Run full matrix and exact-head gates.

### Phase 5 — shadow/canary

Preferred if practical:

- send internal/admin testing to preview hostname;
- optionally mirror safe GET requests for comparison;
- never duplicate mutating production requests unless the shadow target is guaranteed non-mutating.

### Phase 6 — cutover

Only when all gates are green.

### Phase 7 — observe and rollback window

Keep old Railway/Vercel deployments intact and unchanged until the rollback window expires.

### Phase 8 — decommission

After evidence shows the Worker deployment is stable:

- remove Railway custom/public routing;
- remove Vercel production domain/rewrite dependency;
- retain deployment/history evidence;
- remove obsolete secrets from old providers;
- update architecture docs and `.env.example`.

---

## 19. Fast production cutover procedure

The migration should feel like a routing change because all hard work was done beforehand.

### T-48h to T-24h

- freeze unrelated infrastructure changes;
- verify latest Calender branch;
- verify Cloudflare preview exact SHA;
- snapshot environment-name manifest;
- confirm Supabase backups/recovery posture;
- confirm R2 bucket policy;
- confirm OAuth/payment callbacks;
- lower DNS TTL if DNS architecture requires it;
- run complete acceptance suite;
- run load/budget test;
- record rollback owner.

### T-60m

- build/deploy final exact commit;
- verify secrets/bindings;
- run preview smoke;
- run authenticated admin smoke;
- run Class Rep mutation canary in approved test data;
- run Google OAuth test account flow;
- test real R2 evidence read;
- test web push if enabled;
- confirm old production is still healthy.

### T-0

Switch `calender.aido.co.zw` to the Cloudflare Worker/custom-domain route.

Do **not** change Supabase schema as part of the routing event.

### T+0 to T+15m

Run repeatedly:

- homepage;
- runtime config;
- readiness;
- public timetable;
- login;
- admin session;
- Class Rep add recurring class;
- calendar feed;
- OAuth callback;
- source gateway;
- R2 evidence;
- push/payment if enabled.

Watch:

- 5xx rate;
- 401/403 anomalies;
- Worker quota errors;
- Worker CPU exceptions;
- Supabase latency;
- queue backlog;
- callback failures;
- front-end JS errors;
- unexpected cache hits.

### T+15 to T+60m

Continue monitoring traffic and perform mobile/manual UX pass.

Do not decommission old providers yet.

---

## 20. Rollback plan

Rollback must be simpler than debugging under outage pressure.

### Rollback triggers

Rollback immediately for any of:

- authentication broadly broken;
- admin/Class Rep authorization incorrect;
- public timetable unavailable;
- data mutation corruption or duplication;
- OAuth callback broken for real users;
- Worker quota/CPU errors at sustainable traffic;
- unexpected caching of private data;
- source ingestion losing jobs;
- push/payment mutations behaving non-idempotently;
- error rate materially worse than baseline.

### Rollback action

1. route the public domain back to the known-good Vercel production path;
2. Vercel rewrites continue targeting the untouched Railway backend;
3. verify old readiness smoke;
4. freeze Cloudflare mutating background consumers to prevent double-processing;
5. inspect logs using request IDs/release SHA;
6. fix on a new commit;
7. repeat preview gates before another cutover.

Because the first migration keeps Supabase unchanged, rollback does not require a data migration.

This is the strongest reason not to move to D1 at the same time.

---

## 21. Preventing double-processing during coexistence

The dangerous migration state is two backends both believing they own background work.

During preview/canary:

```text
Railway production background consumers = ON
Cloudflare background consumers          = OFF
```

Immediately before/at final cutover, use an explicit ownership flag/lease so only one platform may claim:

- source processing jobs;
- push outbox jobs;
- scheduled reconciliation jobs;
- other asynchronous mutations.

Never rely only on “traffic should be going to the new host.” Background processes can run without user traffic.

Use database-side atomic claiming/idempotency as the final defense.

---

## 22. Cloudflare caching policy

Create automated tests for the exact route groups.

### Never cache

- authenticated APIs;
- session endpoints;
- runtime config;
- OAuth callbacks;
- payment callbacks;
- signed URL generation;
- admin analytics containing private data;
- source review data;
- Class Rep mutation/read endpoints unless explicitly safe.

### Cache only by design

- hashed static assets;
- public immutable branding/media;
- sitemap with bounded TTL;
- public timetable responses only if cache invalidation/version semantics are proven.

### Avoid cache-key identity bugs

Never cache a response whose content changes based on:

- Authorization header;
- cookie/session;
- role;
- private timetable token;
- query parameter not included in cache key.

---

## 23. Domain/DNS/TLS checklist

Before cutover confirm:

- `calender.aido.co.zw` ownership;
- Cloudflare zone active;
- Worker custom-domain route active;
- valid TLS certificate;
- HTTPS redirect behavior;
- HSTS only after HTTPS is confirmed stable;
- no redirect loop through Vercel/Railway;
- apex/`www` behavior if applicable;
- `api.calender.aido.co.zw` legacy behavior documented;
- Google callback public URL unchanged;
- sitemap canonical URLs use public origin;
- OpenGraph/canonical links use public origin;
- email/support/legal links unaffected.

Do not delete legacy DNS/provider records until rollback window closes.

---

## 24. Required pre-migration inventory generated from the codebase

Before implementation, produce a machine-readable inventory of:

### Routes

For each route:

```text
method
path
auth requirement
role requirement
cache policy
body-size limit
external dependencies
mutation/read-only
idempotency strategy
expected p95 latency
```

### Environment/config

For each variable:

```text
name
public/secret
frontend/server
required/optional
default
startup validation
Cloudflare target binding
```

### Background jobs

For each job:

```text
trigger
frequency
claim/idempotency contract
max execution time
retry policy
failure persistence
new Worker primitive
```

### External integrations

- Supabase;
- Google OAuth/Calendar;
- PesePay;
- HIT relay/source gateway;
- R2;
- Web Push.

No route or job is allowed to be “discovered after cutover.”

---

## 25. Definition of Done

The migration is complete only when all of the following are true:

```text
[ ] exact Calender head used
[ ] Cloudflare deployment tied to exact Git SHA
[ ] frontend static assets served by Cloudflare
[ ] /api routes served by Cloudflare Worker
[ ] no Vercel -> Railway rewrite dependency remains
[ ] Supabase production data/auth unchanged during first cutover
[ ] runtime-config.js correct and no-store
[ ] no privileged secret in browser output
[ ] SPA deep links work
[ ] API unknown routes do not return SPA HTML
[ ] legacy redirects preserved
[ ] security headers preserved
[ ] SEO/sitemap/canonical origin preserved
[ ] public timetable canary green
[ ] admin authentication/authorization green
[ ] Class Rep dashboard + recurring class flow green
[ ] light-mode form outlines green
[ ] dark-mode admin dashboard green
[ ] Google OAuth green when enabled
[ ] calendar feed green
[ ] R2 source evidence green
[ ] DOCX canary green
[ ] no published timetable mutation from static import
[ ] source/live watcher authority rules green
[ ] background processing has single owner
[ ] web push green when enabled
[ ] payment flow green when enabled
[ ] no durable local filesystem dependency
[ ] npm ci green
[ ] lint green
[ ] format green
[ ] full tests green
[ ] production build green
[ ] Worker preview integration tests green
[ ] readiness smoke green
[ ] differential parity suite green
[ ] mobile UX pass green
[ ] accessibility pass green
[ ] request/CPU/free-tier budgets have >=20% headroom
[ ] rollback path tested or rehearsed
[ ] Railway/Vercel retained during observation window
[ ] no data/schema migration hidden inside hosting cutover
[ ] production observation window completed
[ ] old provider secrets revoked only after rollback window
```

---

## 26. Recommended migration issue breakdown

When the migration actually starts, create small reviewable issues rather than one giant “move to Cloudflare” task.

1. **CF-01 — Production traffic and free-tier budget baseline**
2. **CF-02 — Route + environment + background-job inventory**
3. **CF-03 — Extract provider-neutral Request/Response application core**
4. **CF-04 — Cloudflare Worker adapter + static assets**
5. **CF-05 — Runtime config, redirects, SEO, security headers parity**
6. **CF-06 — Supabase/Auth Worker compatibility and secret boundaries**
7. **CF-07 — Remove durable local filesystem dependency**
8. **CF-08 — Source processing queue/event conversion**
9. **CF-09 — Web Push queue/event conversion and real VAPID test**
10. **CF-10 — R2 native binding for source object store**
11. **CF-11 — Google OAuth/Calendar callback parity**
12. **CF-12 — Payment/source-relay integration parity**
13. **CF-13 — Cloudflare preview, differential test, load/CPU gates**
14. **CF-14 — Full UX/accessibility/equity acceptance matrix**
15. **CF-15 — Cutover + rollback rehearsal**
16. **CF-16 — Production cutover and observation window**
17. **CF-17 — Vercel/Railway decommission after verified stability**

Each issue should finish with tests on its exact commit. Do not allow a late migration PR to contain an unreviewable runtime rewrite plus unrelated product changes.

---

## 27. Explicit non-goals for the first cutover

Do **not** add these merely because Cloudflare offers them:

- D1 database migration;
- Durable Objects unless a measured concurrency problem requires them;
- KV as a replacement for relational state;
- Workers AI;
- broad architecture rewrites unrelated to runtime compatibility;
- product redesign;
- authentication provider replacement;
- new billing model;
- new timetable source-authority semantics.

The objective is **behavioral parity at lower infrastructure cost**, not novelty.

---

## 28. Final operating principle

The migration succeeds when users cannot tell it happened except that the product is at least as fast and reliable as before.

The safe path is:

```text
measure current production
    -> preserve Supabase data/auth
    -> extract provider-neutral request core
    -> adapt frontend + API to Cloudflare Worker
    -> replace polling with bounded event processing
    -> remove local-disk assumptions
    -> prove exact behavioral parity in preview
    -> prove free-tier headroom
    -> route the public domain
    -> observe
    -> rollback immediately if invariants fail
    -> only then decommission Railway/Vercel
```

**No migration step is allowed to trade correctness, security, accessibility, or UX for a lower invoice.**
