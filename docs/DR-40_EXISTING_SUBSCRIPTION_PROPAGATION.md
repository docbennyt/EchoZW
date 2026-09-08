# DR-40 — Existing Calendar Subscription Propagation Verification

This runbook proves that an already-created CalenderZW subscription follows the current resolved timetable truth without changing its private feed URL, duplicating events, or forcing the student to resubscribe.

## Safety boundary

Use the controlled repository fixture for routine verification. Do not edit the official HIT source document merely to create a canary. Production checks must use an already-authorized test timetable/subscription or a naturally occurring safe source change. Never paste a private feed token into GitHub, Linear, logs, screenshots, or this document.

## Automated contract

From a clean checkout of the review branch:

```bash
npm ci
npm run lint
npm run format:check
npm run test -- tests/dr40ExistingSubscriptionPropagation.test.ts tests/pilotCalendarApiReliability.test.ts tests/publishedCalendar.test.ts
npm run test
npm run build
```

The focused DR-40 scenario models the required CS.1 change:

- before: `ICS1102`, Tuesday 14:00–16:00, `N109`;
- after: the same logical session at `N205`;
- the exact same pre-existing private subscription endpoint is fetched before and after;
- the public class URL remains unchanged.

Expected evidence:

1. the feed returns the new venue on the second fetch;
2. the logical event keeps the same `UID`;
3. `SEQUENCE` increases and `LAST-MODIFIED` advances;
4. no duplicate UID is emitted;
5. unchanged sessions keep stable identity;
6. a newly added logical session appears once;
7. recurring removal disappears from resolved truth, while date-specific cancellation/move uses the repository's existing `EXDATE`/replacement semantics;
8. reminder `VALARM` values remain deterministic;
9. a subscription created through the onboarding transaction continues to resolve the same timetable and feed identity;
10. official-publication and Class Rep correction origins both propagate through the same feed resolver;
11. public URLs and analytics/logging never expose the raw private feed token.

## Optional production-shaped observation

Only after the automated contract is green, an operator may repeat the read-only observation against an authorized existing subscription. Keep the private URL in a local shell variable and never echo it into shared logs.

```bash
export CALENDERZW_FEED_URL='https://<production-host>/calendar/feed/<private-token>.ics'
curl --fail --silent --show-error --dump-header /tmp/dr40-before.headers \
  "$CALENDERZW_FEED_URL" > /tmp/dr40-before.ics
```

After an independently authorized timetable publication/correction has occurred, fetch the **same** URL again:

```bash
curl --fail --silent --show-error --dump-header /tmp/dr40-after.headers \
  "$CALENDERZW_FEED_URL" > /tmp/dr40-after.ics
```

Compare only the local artifacts. For the canary event, verify the UID is unchanged, the intended field changed, `SEQUENCE` increased when calendar-relevant content changed, `LAST-MODIFIED` is newer, and no duplicate UID exists. Also verify the public `/t/:slug` URL is unchanged and contains no feed token.

Delete `/tmp/dr40-before.*` and `/tmp/dr40-after.*` after the review evidence is recorded without secrets.

## Failure interpretation

A stale second fetch means the feed is pinning obsolete truth or a cache validator is wrong. A changed UID for the same logical session means stable identity regressed. Duplicate UIDs/events mean projection or resolved-session identity is broken. A token appearing in a public URL or log is a privacy failure. Any of these blocks DR-40 and therefore blocks the DR-41 production canary.

## Handoff evidence

For review, record only: exact Git commit SHA, focused/full test counts, lint/format/build results, and whether the controlled before/after assertions passed. Do not record the private subscription URL or token.
