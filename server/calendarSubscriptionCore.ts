import { buildFeedUrl } from "../src/domain/calendar.js";
import { generateFeedToken, sha256Base64Url } from "../src/domain/token.js";
import {
  getReminderOffsets,
  toAppleDeepLinkUrl,
  type CreateSubscriptionInput,
} from "../src/domain/subscriptions.js";
import {
  createCalendarSubscriptionRecord,
  PilotApiError,
} from "./pilotRepository.js";

// Provider authorization is a separate workflow. Do not persist a Google connection
// until that workflow has native transport and its original encryption context.
export async function createNativeFeedSubscription(
  input: CreateSubscriptionInput,
  context: {
    publicOrigin: string;
    anonymousSessionId: string;
    env: NodeJS.ProcessEnv;
  },
) {
  let publicOrigin: string;
  try {
    const origin = new URL(context.publicOrigin);
    if (origin.protocol !== "https:" || origin.username || origin.password)
      throw new Error("Invalid public origin");
    publicOrigin = origin.origin;
  } catch {
    throw new PilotApiError(
      "PUBLIC_ORIGIN_INVALID",
      "Calendar setup requires a secure application URL.",
      503,
    );
  }
  if (input.provider === "google_api") {
    throw new PilotApiError(
      "GOOGLE_NOT_CONFIGURED",
      "Direct Google Calendar connection is temporarily unavailable.",
      503,
    );
  }
  const rawToken =
    input.provider === "ics_download" ? undefined : generateFeedToken();
  const tokenHash = rawToken ? await sha256Base64Url(rawToken) : undefined;
  let reminderOffsetsMinutes: number[];
  try {
    reminderOffsetsMinutes = getReminderOffsets(
      input.reminderPreset,
      input.customReminderOffsets,
    );
  } catch {
    throw new PilotApiError(
      "INVALID_REMINDERS",
      "Choose valid reminder offsets.",
      422,
    );
  }
  const feedUrl = rawToken ? buildFeedUrl(publicOrigin, rawToken) : undefined;
  const appleDeepLinkUrl = feedUrl ? toAppleDeepLinkUrl(feedUrl) : undefined;
  const record = await createCalendarSubscriptionRecord(
    {
      timetableId: input.timetableId,
      provider: input.provider,
      reminderPreset: input.reminderPreset,
      reminderOffsetsMinutes,
      timezone: input.timezone,
      anonymousSessionId: context.anonymousSessionId,
      tokenHash,
      subscriberContact: input.subscriberContact,
    },
    context.env,
  );
  const subscriptionId = String(record.id);
  return {
    subscriptionId,
    provider: input.provider,
    calendarName: String(record.calendar_name),
    feedUrl,
    appleDeepLinkUrl,
    appleSubscribeUrl: appleDeepLinkUrl,
    downloadUrl: `${publicOrigin}/calendar/download/${encodeURIComponent(subscriptionId)}.ics`,
    expiresAt: null,
    contact: {
      saved: Boolean(record.subscriber_profile_id),
      countryCode: input.subscriberContact?.countryCode,
    },
    warnings: [],
  };
}
