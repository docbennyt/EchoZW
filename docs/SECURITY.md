# Security

- Validate public mutation input with Zod.
- Do not require student accounts for public timetable viewing.
- Keep provider secrets server-only.
- Do not log OAuth tokens, feed tokens, payment secrets, or student personal data.
- Use unguessable feed tokens and store token hashes in production.
- Verify payment status server-side.
- Prevent private pages from indexing.
- Use audit logs for publishing, rollback, impersonation, feed revocation, and billing changes.
