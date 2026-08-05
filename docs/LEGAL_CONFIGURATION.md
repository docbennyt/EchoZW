# Legal Configuration

Before production Google OAuth submission, the operator must provide reviewed real-world legal details.

Required production environment variables:

- `LEGAL_OPERATOR_NAME`
- `LEGAL_TRADING_NAME`
- `LEGAL_OPERATOR_ADDRESS`
- `LEGAL_COUNTRY`
- `LEGAL_SUPPORT_EMAIL`
- `LEGAL_PRIVACY_EMAIL`
- `LEGAL_EFFECTIVE_DATE`
- `LEGAL_LAST_UPDATED_DATE`
- `PUBLIC_APP_URL`
- `LEGAL_MINIMUM_AGE`
- `LEGAL_GOVERNING_LAW`
- `LEGAL_DISPUTE_VENUE`

Current public URLs:

- Privacy: `https://calender.aido.co.zw/privacy`
- Terms: `https://calender.aido.co.zw/terms`
- Data deletion: `https://calender.aido.co.zw/data-deletion`

Production startup validates these values and fails when required values are blank, non-HTTPS, or contain placeholder text.
