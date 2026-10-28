# Protected Google recovery operations

Run `Cloudflare Google Recovery Operations` from `Calender`. This is trusted
control-plane tooling, not a Worker deployment. It reuses the existing exact-head
application approval, deployment provenance, Cloudflare active-version check,
public identity check and protected test-account sign-in. Configuration-only
versions must retain the reviewed script content hash, runtime and every binding
except the temporary recovery secret; otherwise authentication is blocked. No operator browser
login or exported OAuth credentials are needed.

Provision the private environment secret `CALENDERZW_STAGING_GOOGLE_RECOVERY`
from freshly inspected Supabase records. It contains `candidateSha`, `expiresAt`
(within 24 hours), and up to 25 `subscriptions`, each with `subscriptionId`,
`timetableId`, `ownerId`, `status`, `desiredRevision`, `connectionGeneration`,
`mappingCount`, and `lastSyncedAt`. Never put these values in workflow inputs,
source, issues or logs. No Google credential material belongs in the plan.

Use the existing live application SHA, PR number and successful protected staging
deployment run as workflow inputs. `selection` is a zero-based private-plan
ordinal. The workflow serializes with staging deployments and acceptance.

- `preflight`: validate the private plan and exact runtime identity, without
  administrative authentication or provider calls. Independently refresh database
  backlog and published pause evidence through the connected database tools.
- `preview`: authenticate once using existing protected administrative test
  credentials, then run credential compatibility and actual provider read-only
  previews. `verify` performs the same reads. Every diagnostic request has explicit
  `dryRun:true`, a fixed staging origin and redirect rejection. Failures are
  sanitized, retained per ordinal and cause a failing workflow, while independently
  safe selections still receive their diagnostics.
- `canary`: requires one selected active, previously synchronized connection and
  a successful preview with no ownership conflict, missing/empty calendar,
  creation or deletion. This conservative initial policy permits in-place updates
  only. Review any creation/deletion separately rather than adding an override.
  The preview must also advertise an execution guard matching the selected live
  revision and connection generation with zero allowed creations/deletions. Until
  that guarded runtime is reviewed and deployed, canary mode fails closed; the
  earlier identity-only recovery scope is insufficient for this bounded policy.
  Recheck the approved release and global delivery disabled setting before
  setting the existing single-subscription `GOOGLE_RECOVERY_CANARY` binding. Its
  expiry is at most 30 minutes and never later than the private plan expiry.
  Verify the resulting active Worker version and SHA, enqueue exactly once via
  the existing admin endpoint, and let the existing Queue/leases handle delivery.
  Read-only comparisons wait for bounded continuation. Always revoke temporary
  authorization afterward, including failures and uncertain provisioning responses.
- `disable`: remove temporary recovery authorization. An expired selection plan
  must not prevent revocation. Identity and Cloudflare configuration checks still
  apply. A process killed before cleanup leaves only the bounded authorization TTL;
  the workflow accepts configuration-only versions only after comparing the
  actual script content hash, runtime and retained bindings with reviewed provenance.
  Changed code or unrelated configuration still fails closed.

Reports contain only ordinals, counts, sanitized codes and application/Worker
release identities. No raw provider response or remote deletion candidate IDs are
logged. A credential compatibility result proves decryption only. A full preview
also exercises refresh and Google reads; it does not independently prove write
permissions until Google accepts a mutation.

The current adapter's preview compares local mapping hashes and remote ownership.
`mappingComparisonConverged` therefore is deliberately **not** `fullyVerified`.
Require independent database revision/generation postconditions and actual remote
event content (including EXDATEs and exam preservation) before widening recovery.
Do not count queued requests, snapshots or acknowledged messages as provider
success. No cohort rollout mode exists until this first canary is fully verified.

HIT regular lectures remain suppressed 26 October–30 November inclusive by product
policy. The historical `SWOT Week` label does not shorten that period. Exams must
be separately protected in the shared projection; do not invent exam data.

No production routing or production delivery authorization is granted by these
operations. DR-166 remains the protected production cutover gate.
