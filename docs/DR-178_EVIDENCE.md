# DR-178 Recovery Evidence Ledger

## 2026-10-23 Original Google Key Recovery Candidate

This section supersedes the implementation counts below; historical deployed
evidence remains unchanged. Protected Calender remains `57a7ecf2ab986cb8917168c003c2a2cb293ca82f`.

- Cloudflare settings were read through the authenticated API, returning presence
  booleans only. All four bindings are now present: `TOKEN_ENCRYPTION_KEY`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. The owner
  attests that the encryption key is the recovered original; actual stored-token
  decryption remains an independent runtime acceptance gate, not an assumption.
- `checkGoogleCredentialCompatibility` and the existing targeted admin endpoint's
  `{dryRun:true, credentialCheckOnly:true, subscriptionId}` mode decrypt in memory,
  return safe booleans/version only and perform no provider calls or writes.
  Operational-admin authorization, provider, timetable ownership and revoked-state
  checks precede decryption. A write combined with this diagnostic is rejected.
  Missing key configuration is distinguished from failed credential decryption.
- Independent synthetic Railway-format ciphertext tests and a local workerd
  compatibility probe pass with explicit `nodejs_compat`. This does NOT establish
  real credential compatibility or valid Google authorization. No real refresh
  credential or encryption key was downloaded to the local machine.
- Native transport now includes Google connect/callback/status/disconnect,
  targeted reconciliation, correction/exception edit/remove/undo/deduplication,
  existing scoped/broad pauses, draft sessions/publication, subscription revoke
  and founder-only public settings. The source inventory records 103 routes:
  52 implemented but not live-proven, 2 incomplete, 49 unavailable, 0 bridges.
  No blanket backend-parity claim is made. Imports/source processing remain gaps.
  Google local disconnect is implemented, but optional remote calendar deletion
  fails closed before mutation until durable provider cleanup is available.
- OAuth state consumption is atomic. Existing `v1` AES-GCM storage is preserved.
  Provider operations verify matching private ownership properties before
  updates/deletes. Untagged historical events require ownership review, never
  heuristic deletion. Deterministic IDs recover creates after a crash before
  local mapping persistence; existing mapped calendar/event identities remain.
- Additive migration `0038_google_calendar_delivery.sql` captures revision intent
  transactionally for source publication, corrections, exceptions and pauses.
  Per-subscription leased jobs, generation fencing, transient backoff, credential
  replacement recovery and last-successful revisions are service-role-only.
  Queue messages are wakeups; durable database completion precedes acknowledgment.
  Missing credentials cannot activate pending subscriptions. Migration is NOT
  applied to the live database and `ENABLE_GOOGLE_DELIVERY` remains false.
  Migration `0039_google_calendar_connection_lifecycle.sql` fences OAuth callback
  persistence against concurrent disconnect/reconnect using row locks and
  connection generations. Both migrations require reviewed deployment planning.
- Independent reviewers found no remaining must-fix issue in the delivery SQL
  and native editor/admin transports. A separate reviewer tested the credential
  diagnostic and settings boundary: 41 focused tests passed. The combined real
  PostgreSQL 17 delivery/lifecycle coverage now passes 33 cases, including independent-session concurrency.
  These outcomes are code/test evidence, not deployed authenticated acceptance.
- Final frozen focused run: 152 tests across 10 files pass, including the actual
  PostgreSQL migrations together. Independent Google review passed 109 focused
  tests and 9 lifecycle database cases; no remaining must-fix in that scope.
  Sync calendar/status/mapping writes are fenced against stale connection
  generations. Reconnect delivery intent commits atomically with credentials.
- Trusted deployment bootstrap PR #114 remains review-required. PR #113 remains
  draft. No environment bypass, self-approval, production DNS change, key rotation,
  subscription regeneration or remote Google write was performed. Preserve the
  original Apple ICS Part 1.1 feed proof recorded below.

Dependency audit: npm ci reports 7 inherited advisories (4 moderate, 3 high).
The production dependency subset reports Vite build/dev-server advisories and
ExcelJS's transitive UUID advisory; neither was introduced by the PG test driver.
No forced downgrade or unrelated dependency rewrite was performed. These findings
are not represented as a clean security audit and require scoped remediation.

Next runtime gate: install the independently reviewed trusted bootstrap through
normal governance, approve the exact backend candidate, then use an authorized
dedicated staff session for the single-subscription credential-only diagnostic.
Provider previews, isolated mutation acceptance and explicitly authorized writes
remain separate later gates. Do not report decryption as remote synchronization.

## 2026-10-23 Deployment Trust Boundary

The previous PR workflow checked out candidate code on a runner holding staging deployment and acceptance secrets. Independent security review rejected that boundary. GitHub API inspection confirmed no environment reviewers or branch restrictions. The replacement PR workflow has read-only permissions, no environment, no secrets and no deployment.

Live `cloudflare-staging` protection now requires a reviewer, prevents self-review, disables administrator bypass and allows only `Calender`. The legacy manual deployment workflow is disabled until trusted reviewed workflow code is installed through normal governance. Required branch checks were preserved. The same protections were added to the reserved `cloudflare-staging-acceptance` environment; acceptance currently uses a fresh job in the existing staging environment to preserve the original private-feed secret without copying it.

The proposed trusted dispatch accepts a full immutable candidate SHA, checks current PR head, exact-commit approval by an eligible non-author and successful CI. A secretless runner verifies and bundles the candidate. A fresh runner uses protected-branch tooling/configuration, downloads the exact artifact ID, verifies SHA-256 and a bounded path/symlink allowlist, then deploys the prebundled Worker. The deployment-derived version is independently checked against Cloudflare's active deployment. A fresh acceptance runner rechecks approval and exact source/version before renewable test-account sign-in. Missing admin credentials remain a failing gate.

Independent review approved the narrow static boundary implementation after fixing circular deployment identity, approval revocation during waits, untrusted CI assumptions and artifact verification. This is not operational approval: an exclusive required-workflow or independently controlled check source, reviewed workflow bootstrap onto protected Calender and an eligible independent operator/reviewer remain outstanding. The existing required acceptance check has not been removed, spoofed or replaced with a green PR-only check. The sole current repository collaborator cannot self-approve this path. Do not add staff test credentials before those blockers are resolved.

The original pre-outage Apple ICS Part1.1 feed proof remains valid at `039b0adcd98e44ac7bd26dee0b383b4a570f75d3`: unchanged saved token/path, matching15-event canonical content, stale ETag200/current304. No replacement subscription or token was generated. No source/audit, Google event, production DNS or billing mutation was performed for this boundary change. New native route implementations require separate authenticated deployed acceptance; source inventory counts do not imply that acceptance passed.

## Incident State

Native P0 transport checkpoint: correction collection GET/POST and timetable pause GET/POST/preview/DELETE now use existing shared application services and repositories with request-scoped bindings. No new pause policy was introduced. Scope checks reject foreign timetable pause deactivation even for a broad administrator using a scoped URL. Google propagation is explicitly skipped, never reported as successful. Independent static runtime review found no must-fix finding. Source inventory changes from19 to25 native implementations,82 to76 unavailable,30 to24 unavailable P0 routes;2 incomplete and0 bridges remain. These counts are source implementation evidence, not authenticated runtime acceptance. Google crypto compatibility, OAuth state replay safety, subscription revoke and remaining corrections/item workflows remain separate P0 blockers.

OPEN. Observed 2026-10-19. This is an incomplete recovery candidate, not a production release approval.

- Protected Calender: `57a7ecf2ab986cb8917168c003c2a2cb293ca82f`.
- Recovery branch: `DR-178-native-backend-recovery`.
- Reconciled PR106 head `01eaaaf3bbed4b0e89270de1de62e7cbb8bf9b68` with current mainline; then merged PR111 head `5bf5809459036dcbfb752fcb4218370c8a4abd50` into the candidate only. Neither open PR was merged into protected Calender.
- Production `/api/health/release` and `/api/public/timetables`: HTTP404 `Application not found` from retired backend.
- Production mobile SBT share URL: HTTP200, React mounted, visible `Timetable unavailable`, zero Add to Calendar buttons. Screenshot: local `test-results/dr178-production-outage-mobile.png` (not fabricated, not committed).
- Original staging release: `5bf5809459036dcbfb752fcb4218370c8a4abd50`, Worker version `3c759ed1-380c-44da-964a-a585bef04ea4`, bridge enabled. Dynamic probes returned404 with `cloudflare-staging-bridge`.
- Read-only Supabase snapshot: 19 timetables, 158 subscriptions, 23 correction directives. No production records or provider events changed during recovery development.

## Requirement / Implementation / Test / Outcome

| Requirement                                      | Implementation                                                                                           | Verification                                                                                         | Actual outcome / blocker                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Complete HTTP inventory                          | `scripts/generate-cloudflare-route-inventory.mjs`; JSON/Markdown inventory                               | AST extraction, source fingerprints, drift probe                                                     | 103 concrete routes; 15 implemented/unproven, 2 incomplete, 86 unavailable; zero candidate bridges. This is source consistency, not live parity. |
| Native timetable discovery/detail                | `worker/index.mjs`, `server/publicTimetableCore.ts`, explicit repository environment                     | `tests/cloudflareRecovery.test.ts`                                                                   | Local router/repository tests pass. Live binding absent.                                                                                         |
| Original feed identity and effective corrections | `pilotCalendarCore.ts`, existing resolver/revision/ICS generator, unchanged token hashing                | Real serializer tests: Tuesday present, Wednesday absent, stale ETag200/current304, HEAD             | Local contract passes; original live subscription acceptance BLOCKED. No token rotated.                                                          |
| Staff auth and institutions                      | Existing `requireStaffUser` / `requireOperationalAdmin`; explicit Worker auth clients                    | Anonymous401, admin200, Class Rep403 in router tests                                                 | Mocked external I/O only. Authenticated staging acceptance BLOCKED.                                                                              |
| Non-Google subscription creation                 | Existing schema, token helper, reminder rules, transactional profile/subscription RPC                    | Durable RPC, token hash, private cookie, cross-origin403, oversized413, Google503 before persistence | Local tests pass. Live writes NOT RUN. Google OAuth remains unavailable.                                                                         |
| No hidden Worker fallback                        | Worker/config bridge removed; unsupported API503 JSON                                                    | `check-no-retired-runtime.mjs`; network fetch fails in tests                                         | Candidate-only gate passes; production gate FAILS on seven Vercel rewrites. No claim of production independence.                                 |
| Do not lose unprocessed documents                | Intake authenticated503 before R2/Queue writes; consumer retries; max5 retries then configured DLQ       | No PUT/send/ACK; retry assertions                                                                    | Data-loss path closed. Parsing/import/Queue business parity is still missing.                                                                    |
| Failure observability without private URLs       | Safe request ID, SHA, route class/status/duration only; platform invocation URL logs and traces disabled | Router tests and local workerd responses                                                             | Local HTTP responses include request ID. Live logs/alerts NOT VERIFIED.                                                                          |
| Honest release checks                            | Required native smoke, actual outcome reporting, browser smoke after successful deploy                   | GitHub workflow; mandatory original-feed and admin credentials                                       | Existing green previews are not recovery evidence. Missing acceptance inputs now fail.                                                           |

## Independent Review

Separate reviewer found Worker credentials lost by nested pause/settings repositories, dead Railway fallback, premature queue ACK, false `queued:true`, and misleading inventory/smoke evidence. The candidate fixes these defects with explicit environment parameters, unavailable responses, retry/DLQ preservation and mandatory native checks. A second review of the updated diff was requested. Reviewer findings and their disposition must accompany the PR; no implementer-only go-live declaration is acceptable.

## Local Verification

- Clean `npm ci`: completed; lockfile preserved; six existing dependency audit findings (four moderate/two high), no automatic dependency rewrite.
- First full suite: 768 passed / 769, failure was exact-object assertion before the new max5 retry expectation was applied.
- Second full suite: 768 passed / 769, failure was legacy workflow string assertion after removing the bridge. Updated to assert native release proof, mandatory auth credentials and actual check outcomes.
- Focused router/core/Google/admin tests: 41 passed. After reviewer fixes, the router/foundation/deployment subset passed26 tests.
- Build and Wrangler4.147.0 staging dry-run: passed; Worker gzip244.53KiB at that checkpoint.
- Local actual workerd: release200, liveness200, anonymous staff401, missing server configuration503, unported API503, missing JS404 plain text. No production credentials used.
- Lint passed with four pre-existing frontend warnings. Formatting passed before final evidence edits. Final full suite/CI/deployed acceptance must be recorded against the candidate SHA.

## Secure Provisioning Gate

Railway OAuth connector reports variable names only (`valuesRedacted:true`); do not interpret unreadable values as absent. Cloudflare staging bindings lack Supabase server configuration. GitHub `cloudflare-staging` has the public URL/publishable-key variables but no staff/original-feed acceptance secrets.

Owner provisioned `SUPABASE_SECRET_KEY` during this run; Cloudflare binding-name inspection confirmed it exists. Native deployment/live database acceptance is the next test. Preserve the original `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` for the Google slice; never generate a replacement encryption key. Do not paste credentials in chat.

For automated authenticated/original-feed acceptance, provision `CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN` and `CALENDERZW_STAGING_FEED_URL` as GitHub `cloudflare-staging` environment secrets, using an authorized operator/test context. These secrets must not appear in logs. A native secret inventory/redeployment is required after provisioning. Browser MCP currently reports `Transport closed`; this does not justify bypassing auth or claiming live acceptance.

## Cost And Capacity Checkpoint

Account `workers/account-settings` returned standard usage model; billing subscription query denied authentication. Actual plan, usage, CPU and memory are NOT established. No paid plan activated.

Official references checked 2026-10-19: [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Queue pricing](https://developers.cloudflare.com/queues/platform/pricing/).

Planning assumptions, not measured traffic: each student makes three dynamic web/API calls plus six feed polls/day; add10% request overhead. Static asset bypass is excluded from dynamic request totals. Hourly polling is a stress scenario.

| Students/subscriptions                                   | Model requests/day | Hourly-poll stress/day | 30% request headroom against100,000/day |
| -------------------------------------------------------- | -----------------: | ---------------------: | --------------------------------------- |
| 158 (all stored subscriptions, conservative pilot proxy) |              1,565 |                  4,693 | Request model only fits                 |
| 1,000                                                    |              9,900 |                 29,700 | Request model only fits                 |
| 5,000                                                    |             49,500 |                148,500 | Normal fits; stress fails               |
| 20,000                                                   |            198,000 |                594,000 | Both fail                               |

Free Workers CPU10ms/invocation is independent of request headroom; unmeasured CPU means free-tier feasibility remains unproven. Current native feeds query relational truth on every poll; materialization remains absent and may be required before scale. Queue allowance10,000 operations/day is not10,000 complete jobs: normal send/read/delete consumes operations and retries add more. No source/Google job volume measurement exists. Supabase egress/DB load, R2 usage, OAuth/email costs and failure traffic remain unmeasured. Do not assert zero recurring cost.

## Cutover / Rollback Gate

No production DNS, domain, OAuth configuration or billing changed. Exact DNS backup read via Cloudflare:

```json
{
  "zoneId": "311c1bd991de2261bf1e1977669918e1",
  "recordId": "8af2731495238076d4ba2a6deb6d105a",
  "name": "calender.aido.co.zw",
  "type": "CNAME",
  "content": "8b1b06f90a9284dc.vercel-dns-017.com",
  "proxied": false,
  "ttl": 1
}
```

Production switch remains blocked until native critical routes, original subscriptions, authenticated corrections, Google ownership/encryption, durable work and independent staging acceptance pass on an immutable SHA. Preserve the exact Worker version and resource configuration before any release. A rollback must target a verified functioning Cloudflare version; the retired Railway origin is not a rollback. No functioning full-backend Cloudflare rollback has yet been proven. Obtain separately recorded human go/no-go before production custom-domain/DNS changes and separate approval before cancellation/deletion. Do not touch other aiDo services.

## Next Checkpoint

Provision Supabase server secret, deploy exact candidate to isolated staging, run native smoke plus deployed browser checks, then exercise one authenticated staff read. Continue native Class Rep/subscription lifecycle/Google/background parity as separate reviewable slices. DR-178 and DR-175 remain open; completed ingestion and domain-contract issues remain closed.

## 2026-10-22 Deployed Checkpoint

- PR113: https://github.com/docbennyt/EchoZW/pull/113, draft, needs-human-review. Candidate `a3bb5848d20e439f8e48961db585dea786c4a674` deployed to staging Worker version `48154b85-99f9-4025-bd43-4f0a26aa21ae`. Release reports no legacy bridge.
- GitHub clean CI run39838637500 passed: 152 files, 772 tests, lint, formatting, build, inventory, Worker automation and Wrangler validation.
- Separate final reviewer found no remaining must-fix defect in the public/feed/staff recovery scope; independent test attempts stalled and were not counted as passes. Full backend parity/cutover was not approved.
- External staging checks: release200 matching candidate, backend identity200 matching candidate, readiness200 with all dependency checks OK, discovery200, SE4.1 detail200 with raw15/effective15 and correct Tuesday/Thursday versus removed Wednesday, anonymous staff401, unknown API503, missing asset404 non-HTML. No Railway fallback observed.
- Separate local Playwright browser against deployed staging passed18 desktop/mobile routes: homepage, finder, SBT direct/share, SE4.1, IME, Google return page, admin sign-in, privacy. Timetable pages displayed weekdays/times and opened Add to Calendar. Screenshot `artifacts/browser-smoke/mobile-sbt-share.png` is genuine local evidence, not committed. This does not prove provider handoff or authenticated admin data.
- Owner manual acceptance: sign-in works, institutions fail. Root cause in client `useAdminData`: Promise.all requires institutions/programmes/class-groups/academic-periods/timetables. The initial slice exposed only institutions. Follow-up restores the entire existing read set with the existing operational-admin boundary; mutations remain unavailable.
- Three bounded synthetic subscription acceptance records were created through staging against the existing DB, without personal contact details: two Apple feed canaries and one ICS-download canary. No source sessions/corrections/audit records were changed. No Google events were modified. These are new canaries, not proof of an original subscriber URL.
- ICS download canary: creation201, repeated download200 text/calendar,15 VEVENTs. Apple canaries: creation201, feed503 HTML with explicit `Worker exceeded resource limits`, no Worker request-ID header. Feed failures are not counted as success. This proves Free-tier resource headroom is insufficient on that execution path; request counts alone cannot establish affordability.
- Owner selected **Keep Free; optimize and report limits**. No paid plan or billing change is authorized. Follow-up removes optional per-feed analytics RPC by default (`ENABLE_FEED_ACTIVITY` opt-in, release reports status), retaining redacted request diagnostics. Deployed retest is required; this is not yet proven to remove the CPU failure.
- Native smoke correctly remains failed because authenticated-staff and original-feed acceptance secrets are unavailable. Browser success is reported separately. Production DNS/Vercel rewrites remain unchanged and production outage remains OPEN.

## 2026-10-23 Secure Acceptance Checkpoint

- Starting exact head: `c66ab56b93117e866ca948ea822646163efb2f8d`, existing draft PR113 only. Clean CI rerun39841723921 attempt2 passed. Staging redeploy reports Worker version `46afd4c3-7707-4940-ad3c-611761421d39`, matching source SHA and `legacyBackendBridge:false`. Eight nonprivileged native smoke checks passed again. Missing privileged/original-feed inputs remain failures, not skips.
- The owner reconnected the existing authenticated Chrome session. Browser navigation to `/admin/institutions` rendered Institutions and Harare Institute of Technology. Browser resource observations showed200 for `/api/admin/session` and all five dependent reads: institutions, programmes, class-groups, academic-periods and timetables. No cookies, storage, Authorization headers or tokens were read or exported. This is browser evidence, not proof that GitHub acceptance secrets exist.
- Independent review identified acceptance weaknesses: institutions-only smoke did not cover the complete screen dependency set; a15-event count did not validate calendar truth; fixed access tokens expire. The follow-up adds all five read assertions with no-store, distinct UIDs and corrected Tuesday/Thursday calendar checks, and fresh existing-test-account password sign-in. It changes acceptance tooling only, not application authorization or business logic.
- Renewable CI inputs: `CALENDERZW_STAGING_ADMIN_EMAIL` and `CALENDERZW_STAGING_ADMIN_PASSWORD` in protected GitHub `cloudflare-staging`. Use an existing dedicated test account with its already-approved operational-admin role, not founder credentials. They are exposed only to the smoke step; fresh access tokens remain in memory, provider errors are redacted, redirects are rejected, and authentication has a15-second timeout. Legacy `CALENDERZW_STAGING_ADMIN_ACCESS_TOKEN` remains compatible but is not the preferred renewable path. No account creation, role grant, credential extraction or rotation was performed.
- Original-feed input remains `CALENDERZW_STAGING_FEED_URL`. The operator must securely supply the genuinely retained, pre-recovery subscriber URL and establish provenance against its pre-recovery subscription record before acceptance is signed off. Neither a new canary nor a successful fetch proves provenance. Stored token hashes cannot reconstruct the original random token. A `calendar.google.com` page is not a CZW feed URL. The owner reports they can locate an original feed; verification is still pending.
- No new subscription, source/correction/audit mutation or remote Google write was performed during this checkpoint. Production DNS, billing and runtime ownership are unchanged. Critical Class Rep mutations, Google OAuth/reconciliation, imports and durable background parity remain blockers; production cutover stays blocked regardless of public/admin-read acceptance.
- Independent reviewer approved the narrow acceptance-tooling change after resolving malformed-component, COUNT/cadence and DTSTART/weekday findings; five focused tests independently passed. This is not approval of original-feed provenance, full parity, merge or cutover. Clean install audit currently reports7 inherited dependency findings (4moderate,3high); lockfile/dependencies were not changed or automatically repaired in this acceptance patch.

Latest immutable candidate, complete rerun results, independent reviewer disposition and remaining external inputs are maintained in the existing PR113 live evidence-ledger comment, not inferred from an earlier successful deployment. No full-backend or original-subscriber acceptance is claimed by this checkpoint alone.

## Original Apple Feed Class Binding

The owner securely supplied an original Apple feed and confirmed it belongs to **CS / ICS Part1.1**, not SE4.1. At8e9db6a, its unchanged token/path returned200, stale ETag200 and current ETag304. The content assertion failed because acceptance incorrectly expected SE's ISE4105 events. This did not prove a feed defect. Acceptance now explicitly binds the original-feed secret to protected environment variable `CALENDERZW_STAGING_FEED_TIMETABLE_SLUG=hit-ics-1-1-august-semester-2026`. The independently fetched public class has15 base/effective sessions. The existing published-calendar serializer supplies expected event semantics; private feed UIDs, dates/times, courses, venues, recurrence and exclusions must match, ignoring only subscriber alarms and revision metadata. The SE4.1 correction check remains separate. No token replacement or academic-pause/exam behavior change is involved. Successful live comparison must still be recorded before claiming original-feed acceptance.
