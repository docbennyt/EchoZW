export const productionPlaceholderPatterns = [
  /TODO/i,
  /example\.com/i,
  /Your Company/i,
  /\[LEGAL/i,
  /localhost/i,
  /changeme/i,
  /Lorem ipsum/i,
];

const requiredProductionKeys = [
  "LEGAL_OPERATOR_NAME",
  "LEGAL_TRADING_NAME",
  "LEGAL_OPERATOR_ADDRESS",
  "LEGAL_COUNTRY",
  "LEGAL_SUPPORT_EMAIL",
  "LEGAL_PRIVACY_EMAIL",
  "LEGAL_EFFECTIVE_DATE",
  "LEGAL_LAST_UPDATED_DATE",
  "PUBLIC_APP_URL",
  "LEGAL_MINIMUM_AGE",
  "LEGAL_GOVERNING_LAW",
  "LEGAL_DISPUTE_VENUE",
];

export function validateLegalProductionConfig(
  env: Record<string, string | undefined>,
) {
  const errors: string[] = [];

  for (const key of requiredProductionKeys) {
    const value = env[key]?.trim();
    if (!value) {
      errors.push(`${key} is required for production legal compliance.`);
      continue;
    }
    if (productionPlaceholderPatterns.some((pattern) => pattern.test(value))) {
      errors.push(`${key} contains a placeholder or non-production value.`);
    }
  }

  if (env.PUBLIC_APP_URL && !env.PUBLIC_APP_URL.startsWith("https://")) {
    errors.push("PUBLIC_APP_URL must use HTTPS in production.");
  }

  if (env.PUBLIC_APP_URL) {
    try {
      const url = new URL(env.PUBLIC_APP_URL);
      if (url.hostname !== "calender.aido.co.zw") {
        errors.push("PUBLIC_APP_URL host must be calender.aido.co.zw.");
      }
    } catch {
      errors.push("PUBLIC_APP_URL must be a valid absolute URL.");
    }
  }

  if (errors.length) {
    throw new Error(errors.join(" "));
  }
}
