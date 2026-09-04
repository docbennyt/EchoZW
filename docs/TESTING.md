# Testing

Run:

```bash
npm ci
npx tsc -b --pretty false
npm run test
npm run build
npm run lint
npm run format:check
```

Covered:

- ICS generation.
- Calendar escaping.
- Calendar line folding.
- Reminder validation.
- Next-event calculation around midnight and semester end.
- Public timetable rendering.
- Deployment readiness smoke for schema compatibility, public timetable canary,
  and staff-session availability:

  ```bash
  npm run deploy:check -- --origin https://calender.aido.co.zw
  ```

Recommended next:

- Playwright mobile E2E after browser binaries are installed.
- Automated accessibility checks in CI.
