# Google Domain Verification

Code changes cannot verify domain ownership. Complete this production procedure externally:

1. Sign in to Google Search Console using a Google account that is also an Owner or Editor of the Google Cloud OAuth project.
2. Add a Domain property: `aido.co.zw`.
3. Use DNS TXT verification.
4. Add the TXT record at the authoritative DNS provider for `aido.co.zw`.
5. Wait for DNS propagation.
6. Click Verify in Search Console.
7. Confirm the same Google account remains a project Owner or Editor.
8. In Google Auth Platform -> Branding -> Authorized domains, add: `aido.co.zw`.
9. Do not add: `https://aido.co.zw`, `calender.aido.co.zw`, or `/privacy`.
10. Ensure the OAuth homepage remains: `https://calender.aido.co.zw/`.
11. Resubmit verification only after Search Console ownership is recognised.

Verifying the root domain as a Domain property covers the CalenderZW subdomain for ownership purposes when the correct Search Console property type and project-account permissions are used.

Do not claim the domain is verified until an operator confirms Search Console ownership externally.
