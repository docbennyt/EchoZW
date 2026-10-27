# Staging Google callback repair

The live Google error on 27 October 2026 reported an unregistered callback at
`https://calendar.aido.co.zw/api/calendar/google/callback`. This differs from
both the canonical production host (`calender.aido.co.zw`) and the staging host.
Do not register the misspelled host to work around the error.

For a valid, expiring QA scope, protected staging deployment now sets
`GOOGLE_REDIRECT_URI` to exactly:

`https://next.calender.aido.co.zw/api/calendar/google/callback`

Register that exact address on the existing Google OAuth client after verifying
the client and its current registrations. Preserve its existing production
callback, credentials and calendar.app.created scope. Google Cloud account MFA
and any new OAuth redirect authorization require the owner's participation.

The helper accepts no caller-provided redirect override. Invalid/expired scope
still fails before deployment, and absent scope only disables the canary. This
changes staging bindings through the reviewed deployment, with no production
DNS change and no local secret deployment. It does not establish provider
delivery acceptance; verify the normal browser consent/callback and durable
Queue completion after deployment.
