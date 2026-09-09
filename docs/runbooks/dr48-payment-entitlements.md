# DR-48 — Local payment and semester entitlement runbook

## Status

The code path is deliberately disabled by default. Production checkout is not considered live until all of the following are true:

1. a Pesepay merchant application is approved;
2. production Integration and 32-byte Encryption keys are installed as server-only secrets;
3. the live USD currency and intended payment methods are confirmed in the merchant account;
4. `PESEPAY_MODE=production`, `PAYMENTS_ENABLED=true`, and `PESEPAY_LIVE_VERIFIED=true` are set deliberately;
5. a real-money smoke test verifies hosted checkout, result callback, server-side status re-check, and entitlement creation.

Never set `PESEPAY_LIVE_VERIFIED=true` merely because credentials exist.

## Pricing and pilot rule

The current commercial hypothesis is `semester_pass`, USD 3.00 per semester. It is configured with `CALENDERZW_SEMESTER_PLAN_CODE`, `CALENDERZW_SEMESTER_CURRENCY`, and `CALENDERZW_SEMESTER_AMOUNT_MINOR`; UI reads the safe public capability rather than maintaining a second price constant.

The HIT Undergraduate Pilot remains free through 30 September 2026 by default (`CALENDERZW_PILOT_ENDS_ON`). Pilot calendars must not be silently disabled when monetization starts. The entitlement table supports `pilot_grant` as a first-class source. Before paid launch, backfill one active `pilot_grant` entitlement for each eligible pilot subscriber through that subscriber's current academic-period end date, review the counts, then enable payment for new/non-entitled semesters. `begin_payment_purchase` refuses to charge an already-active entitlement.

## Trust boundaries

- Browser checkout sends an opaque calendar subscription ID plus a UUID idempotency key.
- The server verifies that subscription against the browser's existing anonymous session cookie/header.
- A subscriber profile is created server-side if the calendar was created without optional contact details; payment never requires a phone number.
- Pesepay credentials and poll URLs stay server-side.
- Hosted redirect checkout is used; CalenderZW never stores card numbers, CVV/CVC, or mobile-money account details.
- A return URL never grants access.
- A Pesepay result callback is only a prompt to re-check the transaction using the server-side reference. Only a verified paid status calls `apply_verified_payment`.
- The paid transition and entitlement upsert are transactional and idempotent.
- Raw callback payloads are not stored; only an event fingerprint and coarse gateway status are retained.

## Sandbox verification

Use `PESEPAY_MODE=sandbox` with sandbox credentials and `PAYMENTS_ENABLED=true`. Confirm:

- successful hosted checkout eventually becomes `paid` and creates one entitlement;
- initiated/processing states remain `pending`;
- failed/cancelled states never create entitlement;
- repeating the result callback does not duplicate an entitlement;
- retrying the same checkout idempotency key reuses the purchase;
- an active semester entitlement prevents a second charge;
- `/api/payments/capabilities` exposes only provider readiness, coarse method families, price/currency, plan and pilot date.

## Production rollback

Set `PAYMENTS_ENABLED=false`. This immediately removes checkout capability without deleting purchases or entitlements. Existing calendar service remains independent of payment availability. Investigate provider status and reconciliation before changing any paid entitlement manually.
