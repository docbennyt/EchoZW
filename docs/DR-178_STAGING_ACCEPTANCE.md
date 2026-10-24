# DR-178 Secure Staging Acceptance

Staging is not production. Keep PR113 draft and production DNS unchanged until
critical authenticated and provider acceptance passes. Never export a founder
session, refresh token, private feed URL or encryption key to run these checks.

## Dedicated Admin Account

1. Deploy the exact independently reviewed candidate through **Cloudflare Reviewed
   Staging**, dispatched from protected `Calender`, with Environment approval.
2. The authorized founder uses the existing **Invite Admin** UI on staging. Invite
   a dedicated test mailbox with the existing non-founder Admin role. Do not grant
   Founder, manually insert staff rows, or use password recovery as invitation.
3. For a new invited identity, the mailbox owner follows the normal invitation
   link and sets the account password privately. A confirmed existing identity
   instead receives access through its current account: no invitation email is
   sent and no replacement identity is created. Sign in at
   `https://next.calender.aido.co.zw/admin`. Confirm real institution/timetable
   reads work. No student correction/publication is needed.
4. In GitHub repository Settings, Environments, `cloudflare-staging`, add encrypted
   secrets `CALENDERZW_STAGING_ADMIN_EMAIL` and
   `CALENDERZW_STAGING_ADMIN_PASSWORD`. Use this dedicated account, never the
   founder account. Do not put values in a PR, chat, workflow input or source file.
5. Keep `CALENDERZW_STAGING_FEED_URL` unchanged: it identifies the original Apple
   subscription. Its class binding is `hit-ics-1-1-august-semester-2026`.

Authentication renews through Supabase's existing sign-in contract at acceptance
time. Missing credentials, failed sign-in, missing staff membership or missing
permissions must fail the gate. Public read success is not an Admin acceptance.

## Acceptance-Only Recheck

Use GitHub Actions **Re-run failed jobs** on the reviewed staging run whose deploy
job already succeeded. With only acceptance failed, this reuses the immutable
deployment outputs and reruns acceptance without deploying another Worker:

```powershell
gh run rerun <reviewed-staging-run-id> --failed --repo docbennyt/EchoZW
```

The original workflow must still match the current PR candidate, exact review,
active Cloudflare version and source SHA. It rechecks those before releasing test
credentials. If the candidate, approval or active deployment changed, fail closed
and use a fresh reviewed deployment; do not relax the identity check to reuse an
old run. Environment approval remains required where GitHub requests it.

Run40103326246 deployed `c807c76222eea8abcaec7ea76b550b0df237b8c8`, version
`9b8fcdd0-97e8-4f54-9171-38b73de78bfe`. Original-feed acceptance passed; Admin
acceptance failed because both renewable account inputs were absent. That run
can only be reused while this remains the current approved candidate and version.
The authorized existing dedicated account has since received active non-founder
Admin access through the founder UI; separate login and CI sign-in remain required.

## Credential Compatibility And Provider Gate

After authenticated acceptance, the existing operational-admin diagnostic is:

```text
POST /api/admin/timetables/<owned-timetable-id>/google-calendar-sync
{"subscriptionId":"<authorized-existing-subscription-id>","dryRun":true,"credentialCheckOnly":true}
```

Use the authorized application session or protected acceptance runtime. Do not
copy browser tokens to a terminal or log response bodies containing credentials.
This diagnostic decrypts the existing encrypted credential in memory and returns
safe compatibility booleans/version only. It makes no Google API call, does not
write subscription state, and does not prove provider authorization or delivery.

Keep `ENABLE_GOOGLE_DELIVERY=false` until the continuation migration, bounded
runtime and explicit single-subscription provider canary have passed independent
acceptance. No mass Google reconciliation or subscription regeneration.
