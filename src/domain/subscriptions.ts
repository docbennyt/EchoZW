import { z } from "zod";
import { buildFeedUrl } from "./calendar.js";
import type { CalendarProvider } from "./device.js";
import { validateReminderMinutes } from "./reminders.js";
import type { ReminderPresetId, Timetable } from "./types.js";

export type SubscriptionStatus =
  "pending" | "active" | "disconnected" | "revoked" | "failed";

export type CalendarSubscription = {
  id: string;
  timetableId: string;
  userId?: string;
  anonymousSessionId?: string;
  provider: CalendarProvider;
  reminderPreset: ReminderPresetId;
  reminderOffsetsMinutes: number[];
  calendarName: string;
  timezone: string;
  tokenHash?: string;
  rawToken?: string;
  status: SubscriptionStatus;
  syncedTimetableVersionId?: string;
  externalCalendarId?: string;
  lastSyncedAt?: string;
  lastFeedFetchAt?: string;
  lastErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
};

export const subscriptionRequestSchema = z.object({
  timetableId: z.string().min(4),
  provider: z.enum([
    "google_api",
    "apple_subscription",
    "webcal_subscription",
    "ics_download",
    "outlook_subscription",
  ]),
  reminderPreset: z.enum(["on_time", "prepared", "commuter", "custom"]),
  customReminderOffsets: z
    .array(z.number().int().positive())
    .max(5)
    .default([]),
  timezone: z.string().default("Africa/Harare"),
});

export type CreateSubscriptionInput = z.infer<typeof subscriptionRequestSchema>;

export type CreateSubscriptionResponse = {
  subscriptionId: string;
  provider: CalendarProvider;
  calendarName: string;
  /** Canonical private subscription URL. Always HTTPS in a public production deployment. */
  feedUrl?: string;
  /** Optional Apple convenience deep link derived from feedUrl. The HTTPS feed remains canonical. */
  appleDeepLinkUrl?: string;
  /** Backwards-compatible alias while older UI code is removed. */
  appleSubscribeUrl?: string;
  downloadUrl?: string;
  googleConnectUrl?: string;
  expiresAt: null;
  warnings: string[];
};

export function getCalendarName(timetable: Timetable) {
  return `${timetable.programme} · ${timetable.semester.replace(",", "")}`;
}

export function getReminderOffsets(
  reminderPreset: ReminderPresetId,
  customReminderOffsets: number[],
) {
  if (reminderPreset === "prepared") return [1440, 30];
  if (reminderPreset === "on_time") return [30];
  if (reminderPreset === "commuter") return [60, 15];
  return validateReminderMinutes(customReminderOffsets);
}

export function createSubscriptionRecord(input: {
  timetable: Timetable;
  provider: CalendarProvider;
  reminderPreset: ReminderPresetId;
  reminderOffsetsMinutes: number[];
  anonymousSessionId: string;
  rawToken?: string;
  tokenHash?: string;
}) {
  const now = new Date().toISOString();
  return {
    id: globalThis.crypto.randomUUID(),
    timetableId: input.timetable.id,
    anonymousSessionId: input.anonymousSessionId,
    provider: input.provider,
    reminderPreset: input.reminderPreset,
    reminderOffsetsMinutes: input.reminderOffsetsMinutes,
    calendarName: getCalendarName(input.timetable),
    timezone: input.timetable.timezone,
    rawToken: input.rawToken,
    tokenHash: input.tokenHash,
    status: "pending",
    syncedTimetableVersionId: input.timetable.version,
    createdAt: now,
    updatedAt: now,
  } satisfies CalendarSubscription;
}

export function toAppleDeepLinkUrl(feedUrl: string) {
  const url = new URL(feedUrl);
  if (url.protocol !== "https:") {
    throw new Error(
      "Apple subscription URLs must derive from canonical HTTPS feed URLs.",
    );
  }
  return `webcal://${url.host}${url.pathname}${url.search}`;
}

/** @deprecated Use toAppleDeepLinkUrl; the HTTPS feed URL is the canonical subscription identity. */
export function toWebcalUrl(feedUrl: string) {
  return toAppleDeepLinkUrl(feedUrl);
}

export function buildSubscriptionResponse(input: {
  subscription: CalendarSubscription;
  publicOrigin: string;
  timetable: Timetable;
  externallyFetchable: boolean;
}) {
  const feedUrl = input.subscription.rawToken
    ? buildFeedUrl(input.publicOrigin, input.subscription.rawToken)
    : undefined;
  const downloadUrl = `${input.publicOrigin}/calendar/download/${encodeURIComponent(
    input.subscription.id,
  )}.ics`;
  const googleConnectUrl = `${input.publicOrigin}/api/calendar/google/connect?subscriptionId=${encodeURIComponent(
    input.subscription.id,
  )}`;
  const warnings = input.externallyFetchable
    ? []
    : [
        "This development URL is not externally fetchable. Use a public HTTPS tunnel or preview deployment for Apple, Google, or Outlook subscriptions.",
      ];
  const appleDeepLinkUrl =
    feedUrl && input.externallyFetchable
      ? toAppleDeepLinkUrl(feedUrl)
      : undefined;

  return {
    subscriptionId: input.subscription.id,
    provider: input.subscription.provider,
    calendarName: input.subscription.calendarName,
    feedUrl,
    appleDeepLinkUrl,
    appleSubscribeUrl: appleDeepLinkUrl,
    downloadUrl,
    googleConnectUrl,
    expiresAt: null,
    warnings,
  } satisfies CreateSubscriptionResponse;
}
