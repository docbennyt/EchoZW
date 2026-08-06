# Search Console Ownership

Domain ownership cannot be fixed in application code. `GOOGLE_DOMAIN_OWNERSHIP_CONFIRMED=false` is an informational deployment flag only; it must not be treated as Search Console verification.

Required external procedure:

1. Sign in to Google Search Console.
2. Add a Domain property: `aido.co.zw`.
3. Verify through the DNS TXT record provided by Google.
4. Confirm ownership succeeds.
5. Use a Google account that is also an Owner or Editor of the exact Google Cloud project used for OAuth.
6. In Google Auth Platform Authorized domains, use: `aido.co.zw`.
7. Do not use `https://aido.co.zw`, `calender.aido.co.zw`, or `/privacy` as the authorized domain value.
8. Confirm OAuth homepage: `https://calender.aido.co.zw/`.
9. Respond to the prior verification email or request re-verification only after ownership is visible.

Do not mark ownership verified automatically. The readiness page must continue to show Search Console ownership as requiring external confirmation until a human has verified it in Google Search Console.
