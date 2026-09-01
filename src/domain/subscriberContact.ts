import { z } from "zod";

export const subscriberCountryOptions = [
  { countryCode: "ZW", callingCode: "+263", flag: "🇿🇼", label: "Zimbabwe" },
  { countryCode: "ZA", callingCode: "+27", flag: "🇿🇦", label: "South Africa" },
  { countryCode: "BW", callingCode: "+267", flag: "🇧🇼", label: "Botswana" },
  { countryCode: "ZM", callingCode: "+260", flag: "🇿🇲", label: "Zambia" },
] as const;

export type SubscriberCountryCode =
  (typeof subscriberCountryOptions)[number]["countryCode"];

export type SubscriberContactInput = {
  countryCode: SubscriberCountryCode;
  phone: string;
  consentUpdates: true;
  consentSource: "calendar_onboarding";
};

export type NormalizedSubscriberContact = {
  countryCode: SubscriberCountryCode;
  phoneE164: string;
  consentUpdates: true;
  consentSource: "calendar_onboarding";
};

export const subscriberContactSchema = z.object({
  countryCode: z.enum(["ZW", "ZA", "BW", "ZM"]),
  phone: z.string().trim().min(3).max(32),
  consentUpdates: z.literal(true),
  consentSource: z.literal("calendar_onboarding"),
});

export class SubscriberContactValidationError extends Error {
  constructor(message = "Enter a valid phone number or skip this step.") {
    super(message);
  }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function callingCodeFor(countryCode: SubscriberCountryCode) {
  return subscriberCountryOptions.find(
    (option) => option.countryCode === countryCode,
  )!.callingCode;
}

export function normalizeSubscriberPhone(
  input: SubscriberContactInput,
): NormalizedSubscriberContact {
  const callingCode = callingCodeFor(input.countryCode);
  const countryDigits = callingCode.slice(1);
  let digits = digitsOnly(input.phone);

  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith(countryDigits)) {
    digits = digits.slice(countryDigits.length);
  }
  while (digits.startsWith("0")) digits = digits.slice(1);

  const localLengthByCountry: Record<SubscriberCountryCode, number> = {
    ZW: 9,
    ZA: 9,
    BW: 8,
    ZM: 9,
  };
  const expectedLength = localLengthByCountry[input.countryCode];
  if (digits.length !== expectedLength) {
    throw new SubscriberContactValidationError();
  }

  return {
    countryCode: input.countryCode,
    phoneE164: `${callingCode}${digits}`,
    consentUpdates: true,
    consentSource: input.consentSource,
  };
}
