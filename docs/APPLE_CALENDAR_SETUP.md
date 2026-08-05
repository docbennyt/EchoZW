# Apple Calendar Setup

Apple Calendar uses a personalised read-only subscription feed.

For public HTTPS deployments:

1. Create a personalised subscription.
2. Return `https://.../calendar/feed/<token>.ics`.
3. Convert it to `webcal://.../calendar/feed/<token>.ics`.
4. Navigate to the `webcal://` URL from a user tap.

Do not generate `webcal://localhost...` or `webcal://https://...`.

Localhost cannot be fetched by Apple Calendar. Use a public HTTPS preview deployment or tunnel to test native subscription confirmation.
