# PesePay

PesePay is mocked behind a provider interface in this pilot because live credentials and official integration details are not present.

Production steps:

1. Confirm the current official PesePay API documentation.
2. Fill provider credentials in secure server environment variables.
3. Implement checkout creation.
4. Verify webhook authenticity with the official mechanism.
5. Verify amount, currency, plan, and provider reference server-side.
6. Make callbacks idempotent.
7. Grant entitlements only after trusted payment confirmation.
