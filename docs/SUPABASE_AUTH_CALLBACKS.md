# CalenderZW Supabase Auth callback architecture

Date: 2026-09-07

This document records the supported CalenderZW administrator/Class Rep password-setup flows and the Supabase Dashboard settings required for a reproducible deployment.

## Security boundary

Supabase Auth establishes identity. CalenderZW server-side staff authorization still decides whether that authenticated user is a `superadmin`, a `class_rep`, or has no administrator access.

This document does **not** change:

- `staff_users`
- `class_rep_assignments`
- RLS
- `requireStaffUser`
- `requireSuperadmin`
- `requireTimetableEditor`

No Supabase service-role/secret key belongs in browser code, email templates, or this document.

---

## Public origin

Production origin:

```text
https://calender.aido.co.zw
```

## Auth routes

CalenderZW recognizes these sensitive routes:

```text
/account/update-password
/auth/confirm
/auth/callback
/admin/login
```

The production server serves their SPA shells with `Cache-Control: private, no-store`.

`/auth/confirm` and `/account/update-password` are `noindex, nofollow`.

---

## Supported callback modes

CalenderZW deliberately normalizes three callback formats before exposing password setup.

### 1. Existing implicit Class Rep invitation links

Current Supabase `inviteUserByEmail()` emails can return to:

```text
/account/update-password#access_token=...&refresh_token=...&type=invite
```

CalenderZW:

1. parses the fragment locally;
2. accepts only `type=invite` for this credential shape;
3. requires both access and refresh tokens;
4. immediately removes the fragment from browser history;
5. calls `supabase.auth.setSession(...)`;
6. verifies that a valid session exists;
7. shows first-time Class Rep password setup.

This compatibility path exists so deploying the GitHub repair does not depend on changing hosted Supabase email templates at the exact same moment.

### 2. PKCE password recovery

A recovery callback may arrive as:

```text
/account/update-password?code=...
```

CalenderZW removes the code from the visible URL and explicitly calls:

```ts
supabase.auth.exchangeCodeForSession(code);
```

before validating the session.

### 3. Canonical token-hash confirmation

Preferred long-term flow:

```text
/auth/confirm?token_hash=...&type=invite&next=/account/update-password
```

or:

```text
/auth/confirm?token_hash=...&type=recovery&next=/account/update-password
```

CalenderZW calls:

```ts
supabase.auth.verifyOtp({ token_hash, type });
```

and, after a valid session is established, uses replace navigation to the approved internal destination.

Only the following `next` paths are accepted by application code:

```text
/account/update-password
/admin
/account/settings
```

Any other value falls back to `/account/update-password`. Arbitrary external redirects are not supported.

---

## Supabase Dashboard URL configuration

In **Authentication → URL Configuration**, configure the production Site URL as:

```text
https://calender.aido.co.zw
```

Allow only the redirect destinations actually used by CalenderZW. At minimum for this flow:

```text
https://calender.aido.co.zw/account/update-password
https://calender.aido.co.zw/auth/confirm
```

Retain `/auth/callback` only while other existing CalenderZW Auth flows require it.

Do not add wildcard external domains to solve callback failures.

---

## Recommended hosted email templates

The application already supports today's implicit invitation links. The following token-hash form is the preferred future template architecture when the Supabase project permits Auth template customization.

### Invite template link

Construct the invite action using supported Supabase template variables so the resulting URL is semantically:

```text
https://calender.aido.co.zw/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/account/update-password
```

### Recovery template link

Construct the recovery action so the resulting URL is semantically:

```text
https://calender.aido.co.zw/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/update-password
```

Before changing a production template, verify the exact variable syntax available in the current Supabase project/dashboard and send a test email to a non-production staff test identity.

The code deployment does not require these template changes to be simultaneous because implicit invite compatibility is retained.

---

## Sensitive-data rules

Never log, persist to analytics, or copy into error messages:

- access tokens;
- refresh tokens;
- authorization codes;
- token hashes;
- passwords;
- full callback URLs;
- Supabase privileged keys.

Browser reliability diagnostics may contain only coarse codes such as:

```text
AUTH_INVITE_CALLBACK_INVALID
AUTH_INVITE_SESSION_FAILED
AUTH_INVITE_VERIFICATION_FAILED
AUTH_RECOVERY_CALLBACK_INVALID
AUTH_RECOVERY_CODE_EXCHANGE_FAILED
AUTH_RECOVERY_VERIFICATION_FAILED
AUTH_SESSION_ESTABLISHMENT_FAILED
AUTH_CALLBACK_TYPE_UNSUPPORTED
```

and a safe pathname such as `/account/update-password`.

---

## Production smoke verification

After deployment, verify with real Supabase emails rather than only unit tests.

### New Class Rep

1. Sign in as a superadmin.
2. Create a Class Rep using an email never before present in the project's Supabase Auth users.
3. Confirm the invitation arrives.
4. Click the invitation immediately.
5. Confirm first-time setup says `Finish setting up your account.` rather than reporting a false expiry.
6. Create a valid password.
7. Continue to `/admin`.
8. Confirm the server identifies the account as `class_rep`.
9. Confirm only assigned timetable management is available.

### Existing staff recovery

1. Request a password reset from `/admin/login`.
2. Open the recovery email.
3. Confirm the callback reaches password setup.
4. Set a new password.
5. Sign in with that password.

### Replayed/invalid callback

1. Reuse a consumed or malformed callback.
2. Confirm access fails safely.
3. Confirm no credential remains in the address bar.
4. Confirm server/browser diagnostics contain no credential values.

Production success must not be claimed until these checks have actually been performed against the deployed release.
