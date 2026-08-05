# Billing

Semester Plus is represented through a provider interface and mock PesePay adapter.

Production billing must use:

- pending payment records;
- idempotent provider references;
- amount and currency verification;
- webhook authenticity verification;
- server-side entitlement activation;
- no fake success states in production.
