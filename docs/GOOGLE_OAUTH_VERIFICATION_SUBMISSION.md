# Google OAuth Verification Submission

## Proposed Values

App name: `CalenderZW`

Homepage: `https://calender.aido.co.zw/`

Privacy policy: `https://calender.aido.co.zw/privacy`

Terms: `https://calender.aido.co.zw/terms`

Data deletion: `https://calender.aido.co.zw/data-deletion`

Authorized domain: `aido.co.zw`

Redirect URI: `https://calender.aido.co.zw/api/calendar/google/callback`

Scope: `https://www.googleapis.com/auth/calendar.app.created`

## Scope Justification

CalenderZW helps students add a selected university timetable to a dedicated secondary Google Calendar. The requested permission is used to create that CalenderZW-owned calendar, insert the selected lecture events, apply the student's chosen reminders, and update or remove only those CalenderZW-created events when the timetable changes. CalenderZW does not read, analyse, modify, or delete events from the user's existing personal calendars.

## Demo Video Script

1. Show the browser address bar at `https://calender.aido.co.zw/`.
2. Show the CalenderZW name and logo.
3. Explain the homepage purpose.
4. Show the homepage Google Calendar disclosure.
5. Open a timetable.
6. Select a reminder preset.
7. Tap Add to Google Calendar.
8. Show the in-product pre-consent disclosure.
9. Continue to Google.
10. Show the exact app name CalenderZW on Google's consent screen.
11. Show the requested permission.
12. Approve access.
13. Return to CalenderZW.
14. Open Google Calendar.
15. Show the newly created secondary CalenderZW calendar.
16. Open one event and show title, venue, and reminders.
17. Demonstrate that an existing personal calendar was not read or changed.
18. Change one timetable venue through the admin interface.
19. Publish the update.
20. Show that the existing CalenderZW event updates without duplication.
21. Open account settings.
22. Disconnect Google Calendar.
23. Demonstrate token revocation/deletion behavior and the user's choice regarding deletion of the app-created calendar.

## External Action Checklist

- [ ] Verify `aido.co.zw` as a Domain property in Google Search Console.
- [ ] Use a Google account that is a Cloud project Owner or Editor.
- [ ] Keep `aido.co.zw` under Authorized domains.
- [ ] Set OAuth app name exactly to `CalenderZW`.
- [ ] Upload the same CalenderZW square icon used by the site.
- [ ] Set homepage to `https://calender.aido.co.zw/`.
- [ ] Set privacy URL to `https://calender.aido.co.zw/privacy`.
- [ ] Set terms URL to `https://calender.aido.co.zw/terms`.
- [ ] Confirm support email works.
- [ ] Confirm developer contact email works.
- [ ] Declare only `calendar.app.created`.
- [ ] Confirm exact production redirect URI.
- [ ] Record the verification demo video.
- [ ] Ensure the app is in production status before verification submission where required.
- [ ] Resubmit only after all rejection reasons are fixed.
- [ ] Reply to the existing verification email when instructed instead of creating conflicting duplicate submissions.

## Remaining External Actions

The operator must complete Search Console DNS verification, Google Auth Platform branding fields, OAuth logo upload, support/developer email checks, Google Calendar API project configuration checks, and demo-video recording. Domain ownership remains externally unverified until Search Console confirms it.
