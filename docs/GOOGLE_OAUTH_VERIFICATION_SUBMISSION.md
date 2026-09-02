# Google OAuth Verification Submission

## Production Values

App name: `CalenderZW`

Homepage: `https://calender.aido.co.zw/`

Privacy policy: `https://calender.aido.co.zw/privacy`

Terms: `https://calender.aido.co.zw/terms`

Data deletion: `https://calender.aido.co.zw/data-deletion`

Authorized domain: `aido.co.zw`

Redirect URI: `https://calender.aido.co.zw/api/calendar/google/callback`

Scope: `https://www.googleapis.com/auth/calendar.app.created`

## Scope Justification

CalenderZW helps students add a selected university timetable to a dedicated secondary Google Calendar. The requested permission is used to create that CalenderZW calendar, insert the selected lecture events, apply the student's chosen reminders, and update or remove only those CalenderZW-created events when the published timetable changes. CalenderZW does not list, read, analyse, modify, or delete events from the user's pre-existing personal calendars.

The integration deliberately does not request broad `calendar`, `calendar.events`, or read-only access to the user's other calendars. `calendar.app.created` is the narrow permission that matches the product requirement.

## Production Implementation Contract

The direct Google path is enabled only when all of these are true:

- Google OAuth client ID is configured server-side.
- Google OAuth client secret is configured server-side.
- Redirect URI is exactly `https://calender.aido.co.zw/api/calendar/google/callback`.
- `TOKEN_ENCRYPTION_KEY` is configured server-side.
- Supabase migration `0012_google_calendar_direct_sync.sql` has been applied.

CalenderZW stores single-use OAuth state as a server-side SHA-256 hash with an expiry. Google refresh tokens are stored encrypted with AES-256-GCM using the server-only token-encryption key. Short-lived access tokens are used server-side and are not returned to the browser or written to analytics.

Published timetable versions, Class Rep recurring corrections, and date-specific exceptions all use the same canonical timetable projection before Google event synchronisation. Stable session identity and content hashes are used to update existing Google events rather than creating duplicates when a lecture changes.

## Demo Video Script

1. Show the browser address bar at `https://calender.aido.co.zw/`.
2. Show the CalenderZW name and logo.
3. Explain the homepage purpose.
4. Show the Privacy Policy and Data deletion links.
5. Open a real published timetable.
6. Select `Add to Google Calendar`.
7. Show the first-party pre-consent disclosure explaining that CalenderZW creates a separate secondary calendar and does not read existing personal calendars.
8. Choose a reminder preset.
9. Select `Continue to Google`.
10. Show the exact app name `CalenderZW` on Google's consent screen.
11. Show the requested `calendar.app.created` permission.
12. Approve access.
13. Return to the same CalenderZW timetable and show the connected state.
14. Open Google Calendar.
15. Show the newly created secondary CalenderZW calendar.
16. Open one event and show title, venue, time, and reminders.
17. Show that existing personal calendars remain separate and unchanged.
18. Through the Class Rep/admin workflow, modify one existing timetable session while preserving its stable session identity.
19. Save/publish the approved change.
20. Return to Google Calendar and show that the existing CalenderZW event updates without a duplicate.
21. Return to the public timetable and select `Disconnect Google Calendar`.
22. Explain that disconnect revokes Google authorization and deletes CalenderZW's encrypted credential record; the app-created calendar is retained unless the user explicitly chooses deletion.
23. Show the public Data deletion page and Google Account third-party-connections revocation option.

Do not use a mock timetable or localhost URL in the verification video.

## External Action Checklist

- [ ] Verify `aido.co.zw` as a Domain property in Google Search Console.
- [ ] Use a Google account that is a Cloud project Owner or Editor for domain verification/submission.
- [ ] Keep `aido.co.zw` under Authorized domains.
- [ ] Set OAuth app name exactly to `CalenderZW`.
- [ ] Upload the same CalenderZW square icon used by the production site.
- [ ] Set homepage to `https://calender.aido.co.zw/`.
- [ ] Set privacy URL to `https://calender.aido.co.zw/privacy`.
- [ ] Set terms URL to `https://calender.aido.co.zw/terms`.
- [ ] Confirm the support email works.
- [ ] Confirm the developer-contact email works.
- [ ] Enable Google Calendar API in the production Google Cloud project.
- [ ] Declare only `https://www.googleapis.com/auth/calendar.app.created` under Data Access.
- [ ] Confirm exact production redirect URI.
- [ ] Move the app to the production/external audience state required for public users.
- [ ] Record the verification demo video against the deployed production flow.
- [ ] Submit from Google Auth Platform / Verification Center after branding is published.
- [ ] Reply to an existing Google verification thread when Google instructs this instead of creating conflicting duplicate submissions.

## Manual Pre-Submission Checklist

- [ ] Open Google Auth Platform -> Branding.
- [ ] Check whether Draft Branding differs from Published Branding.
- [ ] Confirm the submitted app name is exactly `CalenderZW` with no leading/trailing whitespace.
- [ ] Confirm the homepage is `https://calender.aido.co.zw/`.
- [ ] Confirm the square OAuth logo is the current CalenderZW icon.
- [ ] Confirm homepage, Privacy, Terms, Data deletion, and Support URLs return direct HTTPS 200 responses.
- [ ] Confirm the homepage visibly presents `CalenderZW` as the app name and describes the product.
- [ ] Confirm Google data-use disclosure and the direct-connect pre-consent page match the actual implementation.
- [ ] Confirm the live OAuth callback returns to the same published timetable after consent.
- [ ] Confirm disconnect works from the live timetable and removes CalenderZW's stored credential.
- [ ] Only then select the Google verification action indicating the issues are fixed / prepare for verification.

## OAuth Logo Operator Note

Use the same square CalenderZW bell-calendar icon in Google Auth Platform. The OAuth logo is configured outside this repository, so this repository does not claim that the external OAuth logo is already updated or published.

## External Boundary

Repository code cannot prove Search Console domain ownership, Google Calendar API enablement, published OAuth branding, verification submission state, or final Google approval. Those remain externally verifiable Google-platform actions and must not be reported as complete until confirmed there.
