# OAuth state owner recovery

Live staging release 8d473f5 reached Google consent with the corrected callback,
but returned `calendar=google-failed`. The isolated QA subscription remained pending,
with no credential, delivery job or remote calendar. This is not provider acceptance.

The callback requires the initiating owner, while the existing state table and
repository projection omit that owner. Mock callback tests supplied a field the
database could never return. Regression coverage now exercises the actual PostgreSQL
state-creation function and the repository projection, including one-time consumption,
foreign-owner rejection, legacy state and service-only function permissions.

The additive migration stores the verified subscription owner under the existing
subscription row lock. The repository returns it on atomic DELETE RETURNING. Existing
owner and generation checks remain in place. Historical states are not backfilled:
ownerless canary states fail closed and require restarting OAuth. No credential,
event mapping, subscription, timetable or pause is changed by the migration.

After independent review of the exact commit, apply
`20261027155427_google_oauth_state_owner.sql` through the database migration tool,
verify the column/function/grants, and deploy that reviewed app through the protected
workflow. Renew the existing selected QA scope for that exact SHA; keep global Google
delivery disabled. Restart the normal QA OAuth flow, verify real Queue/provider
delivery, and preserve the failed run as evidence. Do not rerun or claim its acceptance
passed. Merge the separately reviewed mobile smoke selector repair before dispatching
this candidate so the same deployment receives corrected protected browser acceptance.
Do not redeploy unchanged code merely to repair the verifier. Acceptance-only reruns
remain available when the deployed candidate is still the current independently
reviewed PR head; the previous 8d473f5 deployment is now historical because this PR
has advanced.
