# SE 4.1 production incident acceptance record

Status as of 2026-10-06: server-side production correction verified; real existing-subscriber acceptance pending.

## Incident

The SE 4.1 timetable correction was present in audit/history and in the public API, but existing subscribed calendars could remain stale because production Vercel routed private calendar feed/download URLs into the Vite SPA fallback. Affected routes could return `text/html` and `index.html` instead of `text/calendar` and `VCALENDAR`.

Production hotfix: `9c379856870c688304c35bcb5d27297de866e561`.

## Server-side verification

- Public timetable contains `ISE4105`.
- Course title is `Software Testing & Quality Assurance`.
- Effective time is Tuesday `12:15-13:15`.
- Effective venue is `N109`.
- The obsolete removed session is absent from the effective timetable.
- Private feed transport returns `text/calendar`.
- Feed body starts with `VCALENDAR`, not HTML/JSON.
- Feed cache policy is private/no-cache.
- Conditional GET returns `304`.
- Invalid feed token returns `404`.

## Student acceptance gate

Human acceptance is not complete until at least one existing pre-fix subscriber receives the corrected event without deleting and re-adding the subscription.

Do not collect, paste, store, screenshot, or commit student private feed tokens.

| Tester  | Existing before fix? | Device family | Calendar client | ISE4105 correct? | Tuesday 12:15-13:15 correct? | N109 correct? | Obsolete session absent? | First observed corrected time | Evidence available? | Notes                      |
| ------- | -------------------- | ------------- | --------------- | ---------------- | ---------------------------- | ------------- | ------------------------ | ----------------------------- | ------------------- | -------------------------- |
| Pending | Pending              | Pending       | Pending         | Pending          | Pending                      | Pending       | Pending                  | Pending                       | Pending             | Awaiting student response. |

## Classification

- `PASS`: existing pre-fix subscribers update without unsubscribe/re-add, corrected event is present, obsolete event is absent.
- `PARTIAL`: fresh subscriptions are correct, but existing subscribers are still waiting for provider refresh.
- `FAIL`: direct feed, public timetable, or existing feed content is wrong.

Current classification: `PARTIAL` until existing-subscriber evidence is received.

## Existing-subscriber stale handling

If a real existing subscriber remains stale:

1. Record the stale state and client.
2. Confirm calendar sync is enabled.
3. Use the calendar client's normal refresh/sync action where available.
4. Record first observed corrected time.
5. Classify as provider refresh latency unless the direct feed itself is wrong.
