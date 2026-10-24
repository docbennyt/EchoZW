# Reviewed Staging Acceptance Without Redeployment

This is a protected control-plane repair, not backend recovery acceptance or a
production cutover. PR113 stays draft and production DNS remains unchanged.
Do not deploy this control-plane branch's baseline Worker. The native PR113 Worker
already deployed on staging must remain in place; this workflow only verifies it.
The canonical recovery ledger remains
https://github.com/docbennyt/EchoZW/pull/113#issuecomment-6349725132.

## Observed Failure

Trusted run40111315686 uploaded reviewed candidate
`443c6ab622f583fdd396ed71d850ee19e1ebef27` as Worker version
`12341525-6d46-4fdb-93aa-95f1cf78ca06`. The public release endpoint and independent
Cloudflare deployment API both confirm that version at100 percent with no legacy
bridge. The post-upload verifier rejected the documented direct `deployments`
response because it required the older `success/result/deployments` envelope.
The direct-response regression was reproduced failing before the fix. The fix
supports both shapes but still rejects wrong versions, historical-only matches,
split traffic, failed HTTP requests and provider errors. Nothing skips identity
verification.

The authorized non-founder Admin has already loaded the14-record staff list on
this exact live Worker with HTTP200/no-store. Session role=admin,
isFounder=false,canManageAdmins=false. These browser observations are separate
from renewable CI acceptance, which did not run after the verifier failed.

## Protected Recheck

After independent review and merge of this control-plane repair, run
**Cloudflare Reviewed Acceptance** from protected `Calender` with:

- candidate_sha: `443c6ab622f583fdd396ed71d850ee19e1ebef27`
- pull_request: `113`
- deployment_run: `40111315686`

These inputs are historical evidence, not a mutable default: the workflow requires
that the candidate still equals the current PR head and has exact eligible review
and successful CI. A changed PR head needs a newly reviewed trusted deployment.

The workflow does not deploy anything. It reconstructs the immutable version from
the trusted staging run, successful authorization/package/artifact-verification
steps, the exact deployed artifact ID/digest and matching approved/prepared/uploaded
candidate SHA in protected step logs. Latest job evidence is selected across all
attempts, retaining successful prerequisites after a partial rerun without falling
back past a newer failure. It does not
accept a caller-supplied arbitrary Worker version. It then checks the Cloudflare
active version and public exact SHA/version before releasing test-account inputs.
The protected environment review, post-review authorization recheck, original-feed
test, renewable Admin sign-in and deployed browser checks remain mandatory.

Only code checked out from the protected workflow commit runs with protected
inputs. No PR-head checkout, PR script execution, token export, private feed output
or new subscription creation is permitted. Deployment and acceptance share the
same concurrency group. A final Cloudflare API identity check must still pass.

Missing credentials or a failed check remains a failed release, not a skip.
Approval of this workflow does not authorize production DNS or Google event writes.

## Independent Review

The first adversarial source review found missing binding to the actually deployed
artifact and incomplete partial-rerun handling. Both were reproduced as failing
regressions and corrected. The focused verifier/provenance/boundary suite passes45
tests, and the read-only helper recovers the real deployed version from run40111315686.
These checks do not replace eligible human review of this protected-workflow change.
Final separate source re-review found no actionable findings; ten additional
independent read-only checks covered cancelled/skipped/failed jobs and attempt
precedence. Hosted exact-head full verification remains a separate gate.
