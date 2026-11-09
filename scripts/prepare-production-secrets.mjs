import { writeFileSync } from "node:fs";

const required = [
  "SUPABASE_SECRET_KEY",
  "TOKEN_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_SECRET",
  "EDGE_SOURCE_UPLOAD_SECRET",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
];
const bindings = {};
for (const name of required) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`PRODUCTION_SECRET_REQUIRED_${name}`);
  bindings[name] = value;
}
const onboarding = process.env.GOOGLE_PRODUCTION_ONBOARDING?.trim();
if (onboarding) {
  const { googleOnboardingScope } =
    await import("../server/googleOnboardingPolicy.ts");
  if (
    !googleOnboardingScope({
      APP_ENV: "cloudflare-production",
      ENABLE_GOOGLE_DELIVERY: "false",
      SOURCE_SHA: process.env.CANDIDATE_SHA,
      GOOGLE_PRODUCTION_ONBOARDING: onboarding,
    })
  )
    throw new Error("PRODUCTION_GOOGLE_ONBOARDING_SCOPE_INVALID");
  bindings.GOOGLE_PRODUCTION_ONBOARDING = onboarding;
}
writeFileSync("production-secrets.json", JSON.stringify(bindings), {
  mode: 0o600,
});
console.log(`Prepared ${required.length} protected production bindings.`);
