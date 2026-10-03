# CalenderZW zero-recurring-cost infrastructure migration runbook

> **Status:** active migration programme. Build Cloudflare in parallel; **do not cut production over until every gate in this runbook is proven and human-approved.**
>
> **Last researched:** 2026-10-03
>
> **Migration baseline:** `Calender` at `2b51254d26aa88718f0bb826ae71b653dae07ca4`; implementation branch `DR-152-cloudflare-production-runtime`.
>
> **Primary goal:** make a future Railway -> Cloudflare migration fast, reversible, observable, and boring to users. A successful migration is one where students, Class Reps, Admins, integrations, calendar subscribers, search engines, and operators cannot detect a loss of functionality, reliability, usability, usefulness, accessibility, or trust.

---

## 1. Executive decision

CalenderZW **can target a $0 recurring platform bill**, but `$0 at 50,000 subscribers` is **not automatically guaranteed** by moving the Railway Node server to Cloudflare Workers.

The recommended eventual target is:

```text
                         +---------------------------------------+
                         | Cloudflare                            |
                         |                                       |
Browser / calendar ----->| calender.aido.co.zw                  |
client                   |                                       |
                         | Worker + Static Assets                |
                         |  - Vite SPA assets                    |
                         |  - /api/*                             |
                         |  - /runtime-config.js                 |
                         |  - /sitemap.xml                       |
                         |  - SEO HTML handling                  |
                         |  - auth/integration callbacks         |
                         |                                       |
                         | Queue consumers / Cron                |
                         |  - source processing                  |
                         |  - push delivery                      |
                         |  - recovery/sweeper jobs              |
                         |                                       |
                         | R2                                    |
                         |  - private raw timetable sources      |
                         |  - optional materialized public feeds |
                         +-------------------+-------------------+
                                             |
                                             | HTTPS
                                             v
                              +------------------------------+
                              | Supabase Free                |
                              | Postgres + Auth + APIs        |
                              +------------------------------+

GitHub -> Cloudflare Workers Builds -> per-branch Worker Preview -> production
Cloudflare DNS stays authoritative.
Railway and Vercel remain live during the migration/rollback window only.
```

### Why this is preferable to simply replacing Railway and leaving Vercel forever

1. **It removes the exact split-release failure CalenderZW has already experienced.** PR #77 proved that serving an HTML shell from one deployment and its hashed JS/CSS from another can blank the app when release hashes drift.
2. Cloudflare Workers Static Assets deploys Worker code and static assets together as one versioned unit.
3. Static asset requests are free and unlimited on Cloudflare's current plans when they do not invoke Worker code.
4. Cloudflare Workers Builds can replace most paid/limited CI validation and Railway PR validation infrastructure.
5. Cloudflare Worker Previews provide isolated per-branch Preview and immutable Deployment URLs.
6. Keeping the public browser origin unchanged (`https://calender.aido.co.zw`) means Google OAuth return URLs, password recovery URLs, analytics attribution, PWA scope, and user bookmarks do not need to change simply because the runtime moves.
7. If CalenderZW is operated commercially, Vercel Hobby should not be treated as a permanent free production dependency: Vercel's current Terms state Hobby is for personal or non-commercial use.

### Hard qualification on “50,000 subscribers”

The Workers Free plan currently allows **100,000 Worker invocations per day**. That is only:

```text
100,000 dynamic requests/day / 50,000 subscribers = 2 Worker requests per subscriber per day
```

That budget must also cover normal API calls, auth-related API calls, admin traffic, integrations, callbacks, and private feeds. Calendar clients may refresh subscriptions multiple times per day. Therefore:

- **do not assume 50,000 calendar subscribers fit the Worker free tier** if every calendar refresh executes Worker code;
- make static/frontend traffic bypass Worker execution where possible;
- materialize/cache public calendar feeds rather than querying Supabase on every refresh;
- measure real calendar-client refresh frequency before committing to a `$0 at 50k` promise;
- treat request-volume and Supabase egress, not registered-user count alone, as capacity constraints.

The migration is permitted only after measured traffic proves the free-plan budgets are safe with headroom.

---

## 2. Current production reality that must be preserved

As of this document, production is approximately:

```text
Browser
  |
  v
calender.aido.co.zw
  |
  v
Vercel (Vite SPA + hashed assets)
  |
  +---- /api/* ------------> Railway Node backend
  +---- /runtime-config.js -> Railway Node backend
  +---- /sitemap.xml ------> Railway Node backend
  |
  `---- SPA HTML/assets stay on Vercel

Railway
  |
  +--> Supabase Postgres/Auth
  +--> Google OAuth / Calendar APIs
  +--> optional PesePay
  +--> Web Push delivery worker
  +--> source-processing worker

Cloudflare -> authoritative DNS
GitHub     -> source of truth / CI source
```

Current `vercel.json` is the routing truth at migration-planning time. It proxies only backend-owned routes to Railway and lets the SPA fallback own normal browser pages.

### Current Node entry point is more than “an ICS server”

Do **not** plan this migration as if Railway only serves `.ics` text. `server/productionServer.ts` currently wires at least:

- health/readiness;
- Admin APIs;
- analytics;
- growth capture;
- payments;
- Web Push APIs;
- public timetable APIs;
- source ingestion/processing APIs;
- pilot calendar routes;
- calendar feed routes;
- runtime public configuration;
- SEO responses;
- static/SPA fallback behavior;
- startup configuration validation;
- schema compatibility checking;
- request logging and error boundaries;
- a persistent source-processing worker;
- a persistent push-notification worker.

Any migration that ports only the public calendar feed is incomplete.

---

## 3. Known production migration failures and inconsistencies — never repeat these

### 3.1 The PR #77 blank-page incident: HTML/assets from different releases

**Incident:** `/find` and `/t/:slug` could render a completely white page with the browser error:

```text
Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of text/html.
```

**Root cause:** Vercel proxied the page HTML to Railway while the browser requested relative hashed assets from Vercel. Railway and Vercel were serving different release SHAs. Railway's HTML referenced an asset hash that did not exist on the current Vercel release; Vercel's SPA fallback then returned `index.html` for the missing `.js` request, producing the MIME error.

**Permanent invariant:**

> A browser-visible HTML shell and every hashed JS/CSS asset referenced by that shell MUST be released as one atomic version, or there must be a formally proven version-affinity mechanism that prevents cross-version asset requests.

For the Cloudflare target, prefer **Worker + Static Assets in one deployment**. Do not recreate a Vercel/Railway-style split where Worker-generated HTML points at assets owned by an unrelated deployment.

**Regression checks:**

- request every critical SPA route;
- extract every `<script src>` and stylesheet URL from returned HTML;
- request those exact assets;
- assert `200`;
- assert JavaScript assets return JavaScript MIME, never `text/html`;
- assert CSS returns CSS MIME;
- assert missing hashed assets return a real 404 rather than SPA HTML;
- run the check against the exact Preview deployment and again against the production custom domain after promotion.

### 3.2 Deployment-document/test drift exists today

The current `vercel.json` reflects the PR #77 reliability fix, but older deployment documentation and `tests/dr119DeploymentArchitecture.test.ts` still contain assumptions that `/find` and `/t/:path*` are proxied to Railway.

That inconsistency is itself a lesson:

> Never let provider-specific deployment documentation become the only architecture truth. The migration PR must update config, tests, docs, smoke checks, and diagrams together.

Before beginning the Cloudflare implementation, reconcile stale DR-119 routing assertions with the current PR #77 invariant. Do not “fix” Cloudflare migration tests by reintroducing the old split-origin behavior.

### 3.3 Runtime configuration must remain runtime-safe

`index.html` loads `/runtime-config.js` before React. The current backend intentionally serves only browser-safe values and marks runtime config `no-store`.

Migration risks:

- accidentally injecting service-role or integration secrets into client config;
- caching an old release/config indefinitely;
- frontend and backend reading different Supabase project URLs/keys;
- Preview deployments accidentally receiving production-only values.

The Cloudflare version must preserve the same browser/server secret boundary.

### 3.4 Health/readiness is not the same as app availability

Current production deliberately distinguishes:

- `/api/health/live` — process/runtime availability;
- `/api/health/ready` — configuration, Supabase connectivity, schema compatibility, browser auth/runtime readiness.

The Node server also deliberately does **not** use readiness as a global traffic kill switch. A transient readiness problem must not make static/login/public shells disappear.

On Workers there is no persistent process listening on a port, but the semantic contract should remain:

- `live`: Worker/router is executing;
- `ready`: required configuration and critical dependency/schema checks pass;
- frontend static assets should continue to be served even if a dependency-specific API is degraded.

### 3.5 Railway-specific process assumptions must not leak into Workers

Current Node deployment depends on:

- `PORT`;
- `server.listen(..., "0.0.0.0")`;
- `SIGTERM` / `SIGINT` shutdown;
- Node `http.Server` request/response objects;
- local filesystem reads for serving `dist`;
- persistent timers for workers.

Those are transport/runtime concerns, not business logic. The Cloudflare implementation should separate them from core services instead of emulating a VM inside Workers.

---

## 4. Current free-tier reality — re-verify on migration day

Free plans change. These numbers were verified from official provider documentation on **2026-09-29** and MUST be rechecked before the actual cutover.

### 4.1 Cloudflare Workers Free

Current official limits include:

- 100,000 Worker requests/day;
- 10 ms CPU time per HTTP Worker invocation on Free;
- 128 MB memory;
- 50 external subrequests/request;
- 5 Cron Triggers/account;
- static assets: 20,000 files/version, 25 MiB/file;
- static asset requests are free and unlimited when they do not invoke Worker code.

Official references:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/

**Important:** network waiting does not count as CPU time, but authentication, parsing, compression, XML/ZIP work, crypto, and payload transformation do. Cloudflare specifically notes heavier auth/SSR/payload workloads can run into the 10 ms Free CPU boundary. The real CalenderZW endpoints must be profiled.

### 4.2 Cloudflare Workers Builds

Current Free-plan allowance:

- 3,000 build minutes/month;
- 1 concurrent build;
- 20-minute timeout/build;
- 2 vCPU;
- 8 GB memory;
- 20 GB disk.

Official reference:

- https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/

Workers Builds supports GitHub integration, PR build/check comments, non-production branch previews, configurable build commands, `wrangler preview`, a stable branch Preview URL, and immutable Deployment URLs.

Official references:

- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/previews/

### 4.3 Cloudflare R2

Current Standard-storage free tier:

- 10 GB-month storage/month;
- 1 million Class A operations/month;
- 10 million Class B operations/month;
- free egress.

Official reference:

- https://developers.cloudflare.com/r2/pricing/

CalenderZW's static timetable import architecture already intends private R2 for raw timetable source documents and Supabase for relational metadata/review state. Preserve that boundary rather than moving raw DOCX files back into Supabase Storage merely because the web runtime changes.

When code runs inside Workers, prefer an **R2 binding** over S3 credentials where practical. Bindings grant capability without exposing access-key material to Worker code.

### 4.4 Cloudflare Queues

Current Workers Free allowance:

- 10,000 queue operations/day;
- 24-hour message retention on Free;
- normal successful delivery usually costs three operations: write + read + delete.

So a rough zero-cost upper bound is only about:

```text
10,000 ops/day / 3 ~= 3,333 successful messages/day
```

before retries and larger-message operation multiplication.

Official references:

- https://developers.cloudflare.com/queues/platform/pricing/
- https://developers.cloudflare.com/queues/platform/limits/

This matters particularly for Web Push if notifications become high-volume.

### 4.5 Supabase Free

Current Free allowance includes approximately:

- 50,000 monthly active users;
- 500 MB database size/project;
- 5 GB uncached egress;
- 5 GB cached egress;
- 1 GB Supabase Storage;
- 500,000 Edge Function invocations;
- 2 million Realtime messages;
- 200 Realtime peak connections.

Free projects may pause after one week of inactivity. A project that regularly serves production users should ordinarily remain active, but operational monitoring must detect a paused/degraded project.

Official references:

- https://supabase.com/docs/guides/platform/billing-on-supabase
- https://supabase.com/pricing

**Critical distinction:** 50,000 calendar subscribers are not necessarily 50,000 Supabase Auth MAUs. Public feed consumers that never authenticate should not be counted as Auth MAUs. However, database size and especially 5 GB egress can become the real limit if every public calendar refresh queries Supabase.

### 4.6 GitHub Actions

Current GitHub policy:

- standard GitHub-hosted runners are free for public repositories;
- GitHub Free private repositories include 2,000 standard-runner minutes/month;
- self-hosted runners do not consume GitHub-hosted minute allowance.

Official reference:

- https://docs.github.com/en/billing/concepts/product-billing/github-actions

Do **not** make the repository public solely to obtain free CI. That is a product/IP decision, not a hosting optimization. Workers Builds can remove most routine CI load while keeping the repository private.

### 4.7 Vercel Hobby

Current Vercel Terms state Hobby may only be used for **personal or non-commercial use**.

Official reference:

- https://vercel.com/legal/terms

If CalenderZW is a commercial aiDo product, the long-term `$0` design should therefore move the frontend to Cloudflare Static Assets rather than relying on Vercel Hobby as a permanent commercial production host.

---

## 5. Capacity model: what `$0` really means for CalenderZW

### 5.1 Static frontend traffic is the easy part

With Cloudflare Worker Static Assets configured so normal asset paths do not execute Worker code:

- HTML/JS/CSS/images can be served without consuming the 100k/day Worker invocation quota;
- asset storage has no extra charge under the current Static Assets billing model;
- frontend scale is unlikely to be the first free-tier bottleneck.

### 5.2 Public calendar-feed traffic is the dangerous part

Assume 50,000 active feed subscriptions.

| Average refreshes/feed/day | Feed requests/day | Worker Free result if every request invokes Worker |
|---:|---:|---|
| 1 | 50,000 | feasible in request count, little room for app API |
| 2 | 100,000 | consumes the entire Worker daily request allowance |
| 4 | 200,000 | not free on Workers |
| 8 | 400,000 | not free on Workers |

Therefore the free architecture must make **public timetable feed delivery cache/artifact-first**, not database-compute-first.

### 5.3 Recommended public-feed strategy

For public, published timetables:

1. Generate the canonical `.ics` artifact **when a publication changes**, not on every subscriber poll.
2. Store the generated artifact under a deterministic public publication key in R2 (or an equivalent Cloudflare-served artifact path).
3. Serve it through a Cloudflare-controlled custom hostname with deliberate cache headers.
4. Use atomic object replacement/versioning so a subscriber never receives a half-written feed.
5. Keep publication metadata/version identity in Supabase.
6. Purge/replace the artifact only after the publication transaction is valid.
7. Verify ETag/Last-Modified/conditional request behavior so calendar clients can receive `304` where appropriate.

At 50,000 subscribers refreshing four times/day for 30 days:

```text
50,000 * 4 * 30 = 6,000,000 reads/month
```

That is within the currently advertised R2 Standard free allowance of 10 million Class B operations/month **if** each request maps to one Class B operation and no other R2 usage consumes the balance. Real caching can reduce origin reads further. Recheck pricing/semantics before relying on this.

### 5.4 Private feeds cannot be treated as public static objects

A private/tokenized feed must never be exposed in a public bucket path or cache keyed incorrectly.

For private feeds:

- keep token validation at the Worker;
- use a cache key that cannot cross users if caching is permitted at all;
- never log feed tokens;
- do not expose tokenized URLs in analytics/sitemaps;
- measure private-feed request volume separately because it consumes Worker invocations.

If private feeds grow to tens of thousands of active calendars, `$0` may stop being realistic.

### 5.5 Supabase egress must be protected

Avoid this anti-pattern:

```text
calendar client -> Worker -> Supabase -> generate ICS -> response
```

for every poll. Even if Workers remain under quota, repeated database responses consume Supabase's 5 GB free egress.

Prefer publication-time materialization and edge/object caching for public data.

---

## 6. Runtime compatibility audit — mandatory before coding

Cloudflare now implements a large subset of Node APIs, and Node compatibility is enabled by default for compatibility dates `2026-08-04` or later. This improves package compatibility but does **not** make a persistent Node server equivalent to a Worker.

Official reference:

- https://developers.cloudflare.com/workers/runtime-apis/nodejs/

### 6.1 Refactor transport, not business logic

Do not rewrite every service at once. Introduce a runtime-independent request layer so the same business handlers can be exercised under both Node/Railway and Worker previews during migration.

Target shape:

```ts
export async function handleApplicationRequest(
  request: Request,
  env: AppEnvironment,
  execution: AppExecutionContext,
): Promise<Response> {
  // routing + shared handlers
}
```

Then:

```text
Node adapter      IncomingMessage/ServerResponse <-> Web Request/Response
Cloudflare adapter fetch(request, env, ctx)       -> shared router
```

Keep the Node adapter until Cloudflare has passed soak. That creates a real rollback path.

### 6.2 Audit every Node-specific dependency

Search and classify all uses of:

```text
node:http
node:https
node:fs
node:fs/promises
node:path
node:crypto
Buffer
process.env
process signals
setInterval / long recurring setTimeout loops
stream APIs
local temp files
child_process
worker_threads
net / tls
```

For each occurrence assign:

- works natively in Workers;
- works via current Node compatibility and has an integration test;
- refactor to Web API;
- replace with Cloudflare binding;
- unsupported -> migration blocker.

Do not accept “the package imports successfully” as proof. Exercise the exact methods CalenderZW uses.

### 6.3 Static file serving changes completely

Current Node code reads `dist` with `fs`, computes paths and streams files.

On Cloudflare:

- Vite outputs `dist`;
- Worker Static Assets owns the files;
- Worker code reads/forwards via the Assets binding when dynamic HTML modification is needed;
- do not recreate local filesystem path traversal logic;
- test SPA fallback and real 404 behavior explicitly.

### 6.4 Persistent local filesystem state is forbidden

Any current feature relying on `CALENDAR_STORE_PATH` or other local writable state must be migrated to Supabase/R2/another durable binding before Railway is removed.

Workers instances are stateless and must not be treated as persistent disks.

Create a migration inventory table before implementation:

| State | Current location | Authoritative? | Target | Migration needed? |
|---|---|---:|---|---:|
| timetable/version data | Supabase | yes | Supabase | no |
| auth | Supabase | yes | Supabase | no |
| raw timetable documents | planned R2 | yes for raw object | R2 | preserve |
| public `.ics` artifacts | generated dynamically today | derived | R2/cache | yes, recommended |
| local calendar store if used | filesystem | inspect | Supabase | yes if production-used |
| runtime config | process env -> JS response | derived | Worker env -> response | yes |

---

## 7. Background workers: replace polling with events

Two current server workers are fundamentally VM-style and must not be copied as recurring timers inside an HTTP Worker.

### 7.1 Source processing today

`sourceProcessingWorker.ts` polls approximately every 15 seconds by default.

That is roughly:

```text
86,400 seconds/day / 15 = 5,760 idle polling ticks/day
```

### Target

When source ingestion creates/queues a processing job:

```text
API transaction succeeds
       |
       +--> durable DB job/outbox record
       |
       `--> Cloudflare Queue message { snapshotId, jobId }
                         |
                         v
                  Queue consumer
                         |
                  idempotent claim
                         |
                  process snapshot
                         |
              success/failure persisted
```

Add a low-frequency Cron sweeper only to recover orphaned/stale jobs. Do not use cron as the primary queue.

### 7.2 Push notification worker today

`pushNotificationWorker.ts` polls approximately every 10 seconds by default.

That is roughly:

```text
86,400 / 10 = 8,640 idle polling ticks/day
```

### Target

Creating a push outbox item should enqueue a delivery message. The queue consumer should:

- claim outbox idempotently;
- resolve deliveries;
- send Web Push;
- persist each result;
- handle retry classification;
- finalize outbox;
- tolerate duplicate Queue delivery.

Before cutover, prove the current `web-push` package's exact send path works in Workers. If it does not, isolate and replace only the transport/crypto implementation while keeping domain/retry semantics unchanged.

### 7.3 Queue free-tier guard

Every push/source message consumes Queue operations. Add metrics for queue writes/day, reads/day, deletes/day, retries/day, dead-letter count, oldest message age, and processing failures.

If projected daily Queue operations exceed 70% of the free allowance, the migration plan must explicitly choose whether to optimize, reduce non-essential notifications, or budget for paid infrastructure.

---

## 8. CPU-sensitive workloads that could block a Free Workers cutover

The Workers Free plan's 10 ms CPU/invocation is the most important compatibility constraint after request count.

Create benchmarks for:

- Supabase JWT verification/authorization path;
- Admin authorization;
- public timetable serialization;
- private feed token hashing/verification;
- `.ics` generation;
- sitemap generation;
- SEO HTML transformation;
- PesePay crypto/signature work;
- Google OAuth token encryption/decryption;
- Web Push payload encryption;
- DOCX ZIP/XML validation and deterministic parsing;
- source reconciliation/diffing;
- any PDF/large document feature added later.

### Migration CPU gate

For each endpoint/job capture Cloudflare-reported CPU at p50/p95/p99 under representative fixture sizes.

Use internal safety targets:

```text
p95 CPU <= 7 ms  : comfortable candidate
7-9 ms           : optimize / investigate
>= 9 ms          : do not depend on Free Workers without redesign
```

Those thresholds are internal safety targets, not Cloudflare guarantees.

### DOCX import deserves its own gate

DR-120 source documents can be up to 10 MB and require ZIP/XML validation/parsing. This is exactly the kind of CPU-heavy workload that must be benchmarked rather than assumed compatible.

If deterministic DOCX parsing exceeds Workers Free CPU:

1. do not weaken validation;
2. do not move trust to the browser merely to save money;
3. keep object upload in R2 and metadata in Supabase;
4. benchmark an alternate free compute lane such as a Supabase Edge Function only if its runtime/limits/security fit the same contract;
5. otherwise acknowledge that `$0` is not worth corrupting the safety model.

---

## 9. Target Cloudflare project layout

Exact filenames should follow the repository's eventual refactor, but the conceptual separation should be:

```text
src/
server/
  core/                 # runtime-neutral business services
  adapters/
    node/                # temporary Railway adapter during migration
    cloudflare/          # Worker fetch/queue/scheduled adapters
  ...existing domain/repository modules...
worker/
  index.ts               # fetch + queue + scheduled entrypoints
wrangler.jsonc           # or wrangler.toml; source of Cloudflare bindings/routes
scripts/
  verify-cloudflare-preview.mjs
  verify-asset-release-integrity.mjs
  verify-route-contract.mjs
```

Prefer one production Worker where feasible so static assets and API code share one version. Split into multiple Workers only when isolation, CPU, permissions, or deployment ownership justifies it.

---

## 10. Cloudflare bindings and environment map

### 10.1 Public/browser-safe values

Likely public values include:

```text
PUBLIC_APP_URL
VITE_PUBLIC_APP_URL
VITE_APP_BASE_URL
VITE_SUPPORT_EMAIL
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_ENABLE_*
VITE_LEGAL_*
```

### 10.2 Worker secrets

Migrate server-only values using Cloudflare secrets/secrets store, never `VITE_*`:

```text
SUPABASE_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY (legacy fallback only if still required)
GOOGLE_CLIENT_SECRET
TOKEN_ENCRYPTION_KEY
CALENDAR_TOKEN_HASH_SECRET
HIT_TIMETABLE_RELAY_SECRET
PESEPAY_INTEGRATION_KEY
PESEPAY_ENCRYPTION_KEY
PESEPAY_WEBHOOK_SECRET
WEB_PUSH_VAPID_PRIVATE_KEY
```

Also protect any future R2 S3 access keys, admin service keys, webhook verification secrets, and provider refresh tokens.

### 10.3 Prefer bindings over Cloudflare credentials

When Worker code accesses R2 on the same Cloudflare account, use an R2 binding so the code does not require `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` at runtime.

Retain the generic `SourceObjectStore` abstraction so tests and non-Worker adapters remain portable.

### 10.4 Preview isolation

Worker Previews do not automatically mean database isolation.

Rules:

- Preview MUST NOT run destructive tests against production Supabase.
- Preview write-capable Admin endpoints should use a dedicated non-production Supabase project where available.
- If a production Supabase read-only binding is temporarily used for a Preview smoke, the Preview must be technically prevented from mutations.
- Preview R2 must bind to a separate test bucket/prefix.
- Preview PesePay/Google/webhook credentials must be sandbox/test credentials or disabled.
- Preview Web Push must not notify real subscribers.
- Preview analytics must not pollute production analytics.
- Worker Preview secrets must be explicitly managed; never assume production secret inheritance.

---

## 11. Routing contract for the final single-origin deployment

| Route | Owner | Cache/security expectation |
|---|---|---|
| `/` | Static Assets / SPA | normal HTML caching policy |
| `/find` | same release as SPA assets | no cross-origin HTML |
| `/t/:slug` | same Worker version + assets | dynamic SEO may wrap same release shell |
| `/admin*` | same SPA release | noindex, auth inside app/API |
| `/rep/*` | same SPA release | noindex where appropriate |
| `/privacy`, `/terms`, `/support`, `/data-deletion` | same SPA release | stable public content |
| `/assets/*` | Static Assets | immutable hashes, never SPA fallback |
| `/api/*` | Worker API | no accidental static fallback |
| `/runtime-config.js` | Worker | browser-safe only, `no-store` |
| `/sitemap.xml` | Worker or generated static artifact | XML MIME |
| `/robots.txt` | Static/Worker | text/plain |
| `/llms.txt` | Static/Worker | factual public content only |
| calendar feed routes | Worker or materialized R2 artifact by privacy class | correct calendar MIME/cache |
| OAuth callbacks | Worker | same public origin retained |
| payment webhooks | Worker | strict verification, no browser dependency |

### SPA fallback invariant

Fallback to `index.html` **only** for browser navigation routes that are genuinely client-routed.

Never return SPA HTML for missing `.js`, `.css`, `.map`, `.webmanifest`, image/font assets, `/api/*`, `.ics`, XML feeds, or webhook routes.

This is a direct defense against the PR #77 MIME/blank-page failure class.

---

## 12. SEO migration contract

PR #77 intentionally prioritized page reliability over the old Railway dynamic SEO injection on `/find` and `/t/*`.

Cloudflare creates an opportunity to restore dynamic SEO safely because the Worker and the assets can be in the same release unit.

If dynamic timetable SEO is restored:

1. fetch the version-matched `index.html` from the Assets binding;
2. compute metadata from the canonical published timetable;
3. modify `<title>`, description, canonical, Open Graph and robots metadata;
4. return the modified HTML;
5. keep all referenced assets from that exact Worker release;
6. missing timetable must return HTTP 404 + `noindex`;
7. query variants must canonicalize correctly;
8. no private timetable/feed data enters metadata.

Do not reintroduce SEO by forwarding HTML to a separately deployed server.

---

## 13. Authentication and authorization contract

Migration must not change who can do what.

Required invariants:

- anonymous users retain only public capabilities;
- ordinary authenticated users cannot gain Class Rep/Admin rights;
- Class Rep scope remains limited to assigned context;
- Admin/founder authority remains server-verified;
- role verification fails closed;
- Supabase service credentials never appear in browser bundles/responses/logs;
- password recovery and Supabase auth callbacks return to the same public origin;
- preview environments cannot be used to bypass production authorization;
- CORS remains narrow; same-origin production routing is preferred;
- CSRF/state protections remain equivalent for integrations that use browser redirects;
- request IDs and sanitized audit records survive migration.

### Required negative auth probes

For every privileged route assert:

```text
no token                -> 401
invalid/expired token   -> 401
normal user             -> 403
wrong Class Rep scope   -> 403
correct Class Rep       -> only permitted scoped operations
operational Admin       -> expected allowed operation
```

Run those against a Worker Preview and production after cutover.

---

## 14. Integration-by-integration migration checklist

### 14.1 Supabase

- preserve project URL and key roles;
- keep browser publishable key separate from server privileged key;
- retain schema compatibility checks;
- confirm RLS assumptions still hold;
- verify transaction/idempotency behavior under Worker concurrency;
- verify no dependency relies on a persistent DB TCP connection;
- monitor database size and egress before/after cutover;
- never apply destructive schema changes merely to fit the hosting migration.

### 14.2 Google Calendar direct sync

Keep provider-facing callback:

```text
https://calender.aido.co.zw/api/calendar/google/callback
```

Test state generation/verification, open-redirect safety, callback success/cancel/failure, token encryption, event create/update/delete, duplicate callback idempotency, return to originating timetable, manual fallback, and mobile browser behavior.

### 14.3 Apple/ICS subscription

Test with real clients where available: iOS Calendar, macOS Calendar, Google Calendar URL subscription where applicable, and Outlook/another generic ICS subscriber.

Validate `Content-Type: text/calendar`, stable subscription URL, no redirect loops, line folding/escaping/timezones, publication refresh propagation, no duplicate events, conditional requests if implemented, and private-feed token privacy.

### 14.4 PesePay

If enabled, test signature/encryption compatibility in Worker runtime, return/result URLs, webhook verification, duplicate webhook idempotency, delayed webhook behavior, provider retries, and secret redaction.

### 14.5 Web Push

- service worker subscription remains same scope/origin;
- VAPID keys unchanged unless deliberately rotated;
- existing subscriptions remain usable;
- Queue consumer delivery works;
- 404/410 invalid subscription cleanup preserved;
- retry-after behavior preserved;
- notification click opens correct route;
- migration does not double-send from Railway and Cloudflare simultaneously.

During dual-run, enable the push consumer in exactly **one** environment.

### 14.6 Source Gateway / timetable source processing

- ingestion authentication unchanged;
- snapshots remain immutable;
- processing is idempotent;
- Queue duplicate delivery is harmless;
- parser/reconciliation results match current code;
- no worker path publishes automatically;
- recovery cron can reclaim stale jobs;
- dual-run cannot have both Railway poller and Queue consumer claim the same job incorrectly.

### 14.7 Static DOCX import / R2

Preserve the planned safety contract:

- <= 10 MB enforced;
- extension/MIME/ZIP structure validated;
- SHA-256 content addressing;
- raw DOCX stored in private R2;
- structured metadata/review state in Supabase;
- no credential leakage;
- duplicate object/import idempotency;
- source evidence read access authorized;
- blocking warnings remain blocking;
- upload/review creates draft only;
- publication remains separately guarded.

---

## 15. UX acceptance matrix — migration is not complete until these users are happy

Infrastructure correctness is necessary but insufficient. Validate each flow for functionality, reliability, enjoyability, usefulness, equitability and usability.

### 15.1 Anonymous prospective student

```text
Landing -> Find timetable -> search/select -> published timetable -> subscribe/open calendar
```

Prove landing renders without MIME errors, first useful content is fast on mobile, primary CTA is obvious, loading never looks broken, missing timetable has a useful next action, publication context is clear, public data remains public, calendar choices are understandable, errors are retryable, and provider/DB internals never leak.

### 15.2 Existing calendar subscriber

This is the highest-risk silent migration user because they may never open the website.

Prove old subscription URLs remain valid, redirects work in calendar clients, feeds remain syntactically valid, updates propagate within the documented cache window, no auth prompt appears, events do not duplicate, caching does not make feeds permanently stale, and expected peak refreshes do not cause `429`/quota errors.

### 15.3 Class Rep

```text
Rep login -> role resolution -> new Class Rep dashboard -> recurring class/correction -> save -> confirmation
```

Regression requirements based on recent UI work:

- old legacy Class Rep dashboard must never flash/load;
- role resolution must fail closed;
- recurring-class modal has a visible Save action;
- successful save visibly confirms and updates list;
- duplicate clicks do not create duplicate sessions;
- form outlines remain visible in light mode;
- dark/light theme remains readable;
- stale edit/concurrency errors are actionable;
- mobile keyboard does not hide required CTA.

### 15.4 Operational Admin

Test login/session bootstrap, Overview, institutions, programmes, class groups, academic periods, timetables, Source Gateway, static import, source review/draft creation, guarded publication, corrections review, analytics, team/role management where enabled, and dark/light themes.

No Admin page should become a generic 500 because one unrelated integration is disabled.

### 15.5 Founder/analytics user

Prove privileged analytics stays privileged, aggregates remain correct, no PII/feed-token leaks, loading states preserve layout, and migration release/version identity is visible in diagnostics where intended.

### 15.6 Low-bandwidth / low-end-device user

Test with network/CPU throttling: useful page on slow mobile network, no unnecessary public bundles, effective static caching, offline/retry behavior, safe PWA update, and functionality on a modest Android device.

### 15.7 Keyboard and assistive-technology user

- visible keyboard focus;
- logical headings;
- input labels;
- dialog semantics;
- safe Escape/dismiss behavior;
- no color-only state;
- async success/error announcements where relevant;
- practical WCAG AA contrast;
- reduced motion respected;
- usable touch targets.

### 15.8 Zimbabwe/network-equity checks

- do not assume fast/unmetered data;
- do not require geolocation;
- avoid needless browser polling;
- tolerate intermittent mobile connectivity;
- preserve `Africa/Harare`/canonical timetable timezone semantics;
- keep phone optional where product requirements say optional;
- errors must be understandable by non-technical users;
- no critical flow may depend on a provider page that fails on common mobile browsers.

---

## 16. Required automated test gates

The Cloudflare migration PR must not weaken existing tests to make the new provider pass.

```bash
npm ci
npm run lint
npm run format:check
npm test
npm run build
```

Add a deterministic Worker validation command such as:

```bash
npm run worker:build
# and/or
npx wrangler deploy --dry-run
```

### Preview smoke against the exact immutable deployment

- `/` 200;
- `/find` 200;
- known `/t/:slug` 200;
- unknown `/t/:slug` correct 404 behavior;
- current `/assets/<hash>.js` 200 + JS MIME;
- `/runtime-config.js` 200 + no secrets;
- `/api/health/live` 200;
- `/api/health/ready` expected result for Preview config;
- `/robots.txt`;
- `/sitemap.xml`;
- `/llms.txt`;
- public timetable API/feed canary;
- unauthenticated Admin route denied;
- browser fallback does not swallow missing assets/API.

### Asset-release integrity regression

Create an automated test that:

1. GETs each critical HTML route;
2. parses script/style references;
3. GETs every referenced hashed asset;
4. checks status and MIME;
5. asserts release/version identity where available;
6. fails if any asset receives SPA HTML.

Keep this test forever.

### Worker-runtime integration tests

Use Miniflare/Workers Vitest integration where practical rather than only Node mocks. Test bindings, Request/Response behavior, routes, Queue consumers, scheduled handlers, R2 adapter, and absence of secrets from public output.

### Parity tests

During migration only, run the same deterministic fixture against Node and Worker adapters and compare normalized responses for read-only routes. Ignore only legitimate volatile fields such as request ID, timestamp, provider trace headers, and release/version ID.

---

## 17. CI/CD without Railway validation or paid GitHub minutes

### Recommended PR pipeline

Use Cloudflare Workers Builds on every branch/PR.

Suggested future build command:

```bash
npm ci \
  && npm run lint \
  && npm run format:check \
  && npm test \
  && npm run build \
  && npm run worker:build
```

Preview command:

```bash
npx wrangler preview
```

Production branch:

```text
Calender
```

Only that branch may run the production deploy command.

### Why this replaces Railway PR services

Each non-production branch can get isolated Worker Preview configuration, a stable branch Preview URL, immutable Deployment URL, Cloudflare build/check status on the PR, and its own observability.

This removes the need to create temporary Railway services simply to prove `npm ci`, lint, tests and build.

### Keep GitHub Actions lean rather than mandatory

1. Cloudflare Builds becomes the required PR gate.
2. GitHub Actions may remain as a light secondary gate while within the included private-repo allowance.
3. Trigger expensive GitHub workflows only on release/main/manual dispatch if needed.
4. Avoid useless artifact retention.
5. Do not run duplicate full suites in both systems on every push without a reason.

Do not make the repo public solely to save CI minutes.

### Build-time limit gate

Workers Builds currently has a 20-minute build timeout. Measure exact-head verification time. If close to 20 minutes, remove duplicate work, parallelize safely, split browser E2E from fast PR checks, but never skip security/idempotency/correctness tests merely to fit the timeout.

---

## 18. Migration phases

### Phase 0 — freeze and capture current truth

- [ ] Record current `Calender` SHA.
- [ ] Create an immutable release/tag reference.
- [ ] Export current `vercel.json`.
- [ ] Export Vercel deployment configuration.
- [ ] Export Railway service config, domain, build/start/health settings.
- [ ] Export variable **names** and securely capture values outside git.
- [ ] Export Cloudflare DNS records.
- [ ] Record Supabase project ref and migration history.
- [ ] Record Google OAuth redirects/origins.
- [ ] Record PesePay callbacks if enabled.
- [ ] Record VAPID public-key fingerprint.
- [ ] Record current public smoke results.
- [ ] Record a known published timetable slug.
- [ ] Prepare secure Class Rep/Admin QA accounts or contexts.
- [ ] Record baseline latency/error rates if available.
- [ ] Reconcile stale DR-119 routing docs/tests with PR #77.

No migration starts until this evidence exists.

### Phase 1 — make core request handling runtime-neutral

- [ ] Extract shared Request -> Response router/service layer.
- [ ] Keep Node adapter working.
- [ ] Add Cloudflare fetch adapter.
- [ ] Move deep process-env reads behind typed config boundaries where practical.
- [ ] Preserve startup validation semantics.
- [ ] Port runtime public config.
- [ ] Port security headers.
- [ ] Port request ID/error logging.
- [ ] Port health/readiness semantics.
- [ ] Add Worker version metadata to diagnostics.
- [ ] Prove existing Node tests still pass.

**No DNS changes. Railway remains production.**

### Phase 2 — move static frontend into the same Cloudflare release

- [ ] Configure Vite + Worker Static Assets.
- [ ] Make SPA routes use version-matched assets.
- [ ] Preserve `/dashboard -> /admin` and `/sync/:slug -> /t/:slug` redirects.
- [ ] Define real 404 behavior for non-SPA resources.
- [ ] Restore dynamic SEO only if same-release integrity is preserved.
- [ ] Add asset/MIME regression test.
- [ ] Test PWA/service-worker upgrade across versions.

### Phase 3 — port background processing

- [ ] Source processing -> Queue consumer.
- [ ] Push delivery -> Queue consumer.
- [ ] Add stale-job recovery Cron.
- [ ] Ensure one-and-only-one active production consumer during dual run.
- [ ] Make duplicate Queue delivery harmless.
- [ ] Add queue depth/age/failure observability.
- [ ] Test free-tier operation volume.

### Phase 4 — provision Preview/staging resources

- [ ] Connect GitHub to Workers Builds.
- [ ] Set `Calender` as production branch but do not route production custom domain yet.
- [ ] Enable Preview builds.
- [ ] Create Preview R2 bucket/prefix.
- [ ] Configure safe Preview variables/secrets.
- [ ] Ensure Preview cannot mutate production accidentally.
- [ ] Run full build/test gate in Workers Builds.
- [ ] Run smoke on immutable Preview URL.
- [ ] Run manual UX matrix on stable branch Preview URL.

### Phase 5 — shadow/parity verification

For read-only requests compare Railway and Worker output: health semantics, public timetable JSON, feed bytes after normalizing volatile timestamps, sitemap, runtime config public values, public SEO status/canonical, redirects/status codes, caching and security headers.

Do **not** shadow mutating Admin, payment, OAuth, source-import or notification requests into both systems.

### Phase 6 — migration rehearsal

Perform the whole cutover against a staging/custom test hostname first, e.g. `next.calender.aido.co.zw`.

- [ ] same Cloudflare zone behavior;
- [ ] same TLS;
- [ ] same routing patterns;
- [ ] safe test integration credentials;
- [ ] mobile QA;
- [ ] calendar-client QA;
- [ ] rollback rehearsal;
- [ ] quota dashboards visible.

No production cutover until human sign-off.

### Phase 7 — production cutover

Preconditions:

- [ ] exact Worker deployment SHA/version recorded;
- [ ] all automated gates green;
- [ ] Preview UX matrix green;
- [ ] CPU/request/Queue projections < 70% free limits under realistic peak model;
- [ ] Supabase DB/egress projections < 70% quota;
- [ ] rollback rehearsed;
- [ ] Railway and Vercel remain active;
- [ ] DB migrations backward-compatible with old/new runtimes;
- [ ] no destructive migration bundled with hosting cutover.

Cutover:

1. Freeze unrelated production merges.
2. Confirm Worker production deployment equals reviewed SHA.
3. Run pre-cut smoke on immutable Worker Deployment URL.
4. Disable/move only background consumer authority that would double-process jobs.
5. Attach/activate `calender.aido.co.zw` on Worker.
6. Confirm TLS.
7. Run public-origin smoke immediately.
8. Run asset-integrity check immediately.
9. Test one real public timetable/feed.
10. Test auth/session boundary.
11. Run one controlled Class Rep write.
12. Run one controlled Admin operation.
13. Test OAuth callback if safe account available.
14. Observe errors, CPU, request count, Queue, Supabase egress.
15. Keep deployment freeze until initial soak passes.

### Phase 8 — soak

Recommended:

```text
7 days minimum; 14 days preferred when Railway renewal timing permits.
```

During soak require no unexplained Worker CPU terminations, quota spikes, ICS complaints, auth regression, duplicate jobs, blank-page/MIME errors, PWA stale-release loop, callback regression, or user-facing latency degradation.

Only after soak remove Vercel production dependency if final target is all Cloudflare, cancel Railway, remove provider-only secrets after evidence is captured, clean previews, and update final architecture docs.

---

## 19. Rollback plan — recover production in minutes

Keep the last known-good Vercel deployment, Railway deployment, exact old DNS records, old provider secrets/config, and a backward-compatible DB schema throughout the rollback window.

### Immediate rollback triggers

- critical blank pages/MIME failures;
- weakened auth boundary;
- broad feed failure;
- Worker CPU errors on critical paths;
- projected Worker quota exhaustion;
- material Supabase egress spike;
- Google OAuth failure;
- Admin/Class Rep duplicate/failed writes;
- payment webhook failure;
- source/push duplication;
- any data-integrity discrepancy.

### Rollback sequence

1. Stop Cloudflare-only background consumers to prevent duplicate processing.
2. Restore previous public routing/DNS to Vercel + Railway using captured exact records.
3. Verify `/`, `/find`, known `/t/:slug`, current hashed JS, `/runtime-config.js`, `/api/health/ready`.
4. Re-enable Railway worker authority if disabled.
5. Confirm no queued jobs were lost; replay only idempotently.
6. Do **not** roll Supabase schema backward reflexively.
7. Preserve Cloudflare logs/version IDs/failure evidence.
8. Open an incident issue before another cutover attempt.

### Database rule

Use expand/contract database changes so both runtimes can operate during rollback. Never combine provider cutover and destructive column/table removal in one release.

---

## 20. Reliability/failure-injection matrix

| Failure | Expected user result |
|---|---|
| Supabase unavailable | static public shell still loads; API returns branded/retryable error |
| Worker API exception | generic structured error + request ID; no secret |
| Queue duplicate | idempotent result, no duplicate business effect |
| Queue delay | job status truthful; no false success |
| Google API timeout | retry/actionable UI, no lost local state |
| payment timeout | pending/idempotency preserved |
| R2 unavailable | source flow fails closed; metadata cannot falsely claim complete object |
| missing JS asset | real 404, never HTML-as-JS |
| stale service worker | update path recovers; no permanent blank app |
| Worker quota near limit | alert/capacity action before hard failure |
| Worker CPU limit exceeded | migration blocker/rollback for critical path |
| Supabase quota near limit | alert/capacity action before restriction |
| browser offline mid-form | no false success/duplicate; retry possible |
| double submit | loading/idempotency prevents duplicate |
| concurrent Admin/Rep edits | existing stale-edit/idempotency safety preserved |

---

## 21. Performance and enjoyability targets

Keep field CWV targets:

```text
LCP <= 2.5 s
INP <= 200 ms
CLS <= 0.1
```

Record real pre-cut baseline and compare after migration for public timetable API, feed, auth/session bootstrap, Admin first useful render, Class Rep first useful render, JS transfer size, error rate, Supabase egress/request, and Worker CPU/request.

A migration that saves $5 but noticeably worsens task completion or reliability fails the product goal.

---

## 22. Security review before promotion

- [ ] no server secret in Vite bundle;
- [ ] no server secret in `/runtime-config.js`;
- [ ] no secret in Worker logs;
- [ ] no signed R2 URL logged/stored permanently;
- [ ] raw-source R2 bucket private;
- [ ] CORS narrowed;
- [ ] security headers preserved;
- [ ] HSTS behavior understood at Cloudflare edge;
- [ ] webhook verification before mutation;
- [ ] OAuth state validated;
- [ ] no open redirect;
- [ ] Admin/Class Rep authorization server-side;
- [ ] sensitive previews protected;
- [ ] preview robots/noindex or Access as appropriate;
- [ ] rate/abuse controls reviewed;
- [ ] private feed tokens absent from logs/analytics;
- [ ] R2 binding scoped minimally;
- [ ] old provider credentials revoked only after rollback window.

---

## 23. Observability and version identity

Use Cloudflare Worker Version Metadata binding and expose safe diagnostics such as provider, Worker version ID, and explicit build commit SHA.

Every error log should preserve event name, request ID, route class, status/error code, duration, Worker version, and sanitized dependency-failure class.

Never log Supabase service key, Google secret/tokens, PesePay secrets, VAPID private key, raw auth headers, private feed tokens, signed R2 URLs, or raw sensitive documents.

---

## 24. Cost/usage guardrails

A `$0` strategy without quota monitoring is not a strategy.

Track Cloudflare Worker requests/day, CPU p95/p99, errors/1102/1027, R2 GB/Class A/Class B, Queue operations/retries/backlog, and Build minutes.

Track Supabase MAU, DB size, uncached/cached egress, Edge Function usage if added, and Realtime usage if applicable.

Internal thresholds:

```text
70% = investigate trend
85% = optimization/capacity action required
95% = release freeze on traffic-increasing changes until resolved
```

Do not wait for a hard free-tier rejection to discover growth.

---

## 25. What not to do

- Do not shut Railway down first and then start porting.
- Do not use DNS cutover as the first end-to-end test.
- Do not proxy SPA HTML from one release while assets come from another.
- Do not assume `nodejs_compat` makes every npm package safe.
- Do not replace persistent loops with `setInterval()` in a Worker.
- Do not poll a queue table every 10-15 seconds if an event can enqueue work.
- Do not query Supabase to regenerate identical public ICS on every poll.
- Do not place production service keys in Preview builds.
- Do not make the repo public solely for GitHub Actions minutes.
- Do not treat Vercel Hobby as a guaranteed commercial free tier.
- Do not use Fly.io or any provider based on an old “free VM” assumption without rechecking current pricing.
- Do not apply destructive DB changes during hosting cutover.
- Do not shadow side-effecting payment/OAuth/push/source requests into both stacks.
- Do not declare success because `npm run build` passes.
- Do not delete Railway/Vercel before a real soak/rollback window passes.

---

## 26. Migration-day evidence template

```text
MIGRATION RELEASE
Current Calender SHA:
Cloudflare build ID:
Cloudflare Worker version ID:
Cloudflare immutable deployment URL:
Cloudflare stable preview URL:
Production URL:
Migration operator:
Start UTC:
End UTC:

LIMITS RE-VERIFIED ON:
Workers requests/day:
Workers free CPU/request:
Workers Builds minutes/month:
R2 storage/Class A/Class B:
Queues ops/day:
Supabase MAU/DB/egress:

EXACT-HEAD GATES
npm ci: PASS/FAIL
lint: PASS/FAIL
format: PASS/FAIL
tests: PASS/FAIL
Vite build: PASS/FAIL
Worker build/dry-run: PASS/FAIL
Preview smoke: PASS/FAIL
Asset-release integrity: PASS/FAIL
Runtime integration tests: PASS/FAIL

MANUAL FLOWS
Landing/finder: PASS/FAIL
Published timetable: PASS/FAIL
ICS real client: PASS/FAIL
Rep login/dashboard/write: PASS/FAIL
Admin login/dashboard/write: PASS/FAIL
Google OAuth: PASS/FAIL/N/A
Web Push: PASS/FAIL/N/A
PesePay: PASS/FAIL/N/A
Static DOCX import: PASS/FAIL/N/A
Source Gateway: PASS/FAIL/N/A
PWA/offline/update: PASS/FAIL
Mobile 360/390/412/768: PASS/FAIL
Keyboard/screen-reader basics: PASS/FAIL
Light/dark mode: PASS/FAIL

PRODUCTION AFTER CUTOVER
/ 200:
/find 200:
/t/<known> 200:
/t/<missing> 404:
current JS asset 200 + JS MIME:
/runtime-config.js:
/api/health/live:
/api/health/ready:
/robots.txt:
/sitemap.xml:
calendar feed canary:
admin unauth boundary:
release/version identity:

ROLLBACK
Railway known-good deployment ID:
Vercel known-good deployment ID:
Old DNS export location:
Rollback rehearsed: YES/NO
Rollback executed: YES/NO
```

---

## 27. Final acceptance definition

The Railway/Vercel -> Cloudflare migration is complete only when:

```text
current Calender exact head
-> full code/config/docs inventory captured
-> stale deployment contracts reconciled
-> shared runtime-neutral request layer
-> Cloudflare Worker adapter
-> Worker + Vite Static Assets deployed atomically
-> no split-origin HTML/hashed-asset possibility
-> Supabase auth/data behavior unchanged
-> public feeds capacity-designed for 50k scale
-> source processing event-driven
-> push delivery event-driven
-> R2 source-object contract preserved
-> Google Calendar flow preserved
-> payment flow preserved if enabled
-> runtime config safe
-> security/auth boundaries preserved
-> exact-head lint/format/tests/build green
-> Cloudflare Worker-runtime tests green
-> isolated branch Preview green
-> immutable Preview smoke green
-> all key personas manually QA'd
-> mobile/accessibility/low-bandwidth QA green
-> Worker CPU/request usage has >=30% headroom
-> Supabase capacity has >=30% headroom
-> rollback rehearsed
-> production custom domain cut over
-> production smoke green
-> 7-14 day soak green
-> old providers removed only after soak
-> final architecture docs updated
```

If any critical item is unproven, Railway remains the fallback and the migration is **not finished**.

---

## 28. Recommended decision for CalenderZW now

**Migration implementation is now active, but production cutover remains gated.** Build and prove Cloudflare beside the known-good Vercel/Railway baseline; do not remove rollback infrastructure or change production DNS until rehearsal, exact-head validation and human sign-off are complete.

Recommended sequence:

1. Keep current production stable.
2. Preserve PR #77's same-release asset invariant.
3. Make the application runtime-neutral behind adapters.
4. Benchmark real Worker CPU and daily request demand.
5. Convert polling workers to event-driven Queues before cutover.
6. Materialize public calendar feeds so 50k subscribers do not each burn Worker/Supabase compute on every refresh.
7. Move routine PR validation to Workers Builds + Worker Previews.
8. Move both frontend and backend to one Cloudflare Worker + Static Assets release if commercial Vercel Hobby use is not appropriate.
9. Keep Supabase Free while MAU/database/egress have measured headroom.
10. Retire Railway only after a reversible production soak.

That is the path to a **real** `$0 recurring infrastructure target` without exchanging a $5 bill for fragile production.

---

## 29. Official references to re-check before migration

Cloudflare:

- Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Static Assets billing: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Node compatibility: https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- Workers Builds: https://developers.cloudflare.com/workers/ci-cd/builds/
- Builds limits/pricing: https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/
- Builds configuration: https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- Worker Previews: https://developers.cloudflare.com/workers/previews/
- Queues pricing: https://developers.cloudflare.com/queues/platform/pricing/
- Queues limits: https://developers.cloudflare.com/queues/platform/limits/
- Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/
- Version metadata: https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/

Supabase:

- Billing: https://supabase.com/docs/guides/platform/billing-on-supabase
- Pricing: https://supabase.com/pricing
- Egress: https://supabase.com/docs/guides/platform/manage-your-usage/egress

GitHub:

- Actions billing: https://docs.github.com/en/billing/concepts/product-billing/github-actions

Vercel:

- Terms / Hobby restriction: https://vercel.com/legal/terms

CalenderZW repository evidence:

- PR #77 split-release incident: https://github.com/docbennyt/EchoZW/pull/77
- `vercel.json`
- `server/productionServer.ts`
- `server/sourceProcessingWorker.ts`
- `server/pushNotificationWorker.ts`
- `.env.example`
- `.github/workflows/ci.yml`
- `tests/vercelSpaAssetOrigin.test.ts`
- `tests/dr119DeploymentArchitecture.test.ts`
- `docs/DEPLOYMENT_VERCEL_RAILWAY.md`
- `docs/CALENDERZW_PRODUCTION_PRELAUNCH_CHECKLIST.md`
