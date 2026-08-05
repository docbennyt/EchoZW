import type { CalendarSubscription } from "./subscriptions.js";
import type { Timetable } from "./types.js";

export type GoogleCalendarEventPayload = {
  id: string;
  summary: string;
  location?: string;
  start: {
    dateTime: string;
    timeZone: string;
  };
  end: {
    dateTime: string;
    timeZone: string;
  };
  recurrence?: string[];
  reminders: {
    useDefault: false;
    overrides: Array<{ method: "popup"; minutes: number }>;
  };
  extendedProperties: {
    private: {
      internalEventId: string;
      timetableVersionId: string;
    };
  };
};

export function mapToGoogleEvents(
  timetable: Timetable,
  subscription: CalendarSubscription,
) {
  const reminders = [...new Set(subscription.reminderOffsetsMinutes)].map(
    (minutes) => ({
      method: "popup" as const,
      minutes,
    }),
  );

  return timetable.events.map(
    (event) =>
      ({
        id: event.id.replace(/[^a-z0-9_-]/gi, "").toLowerCase(),
        summary: `${event.courseCode} · ${event.title}`,
        location: event.location,
        start: {
          dateTime: event.startsAtLocal,
          timeZone: event.timezone,
        },
        end: {
          dateTime: event.endsAtLocal,
          timeZone: event.timezone,
        },
        recurrence: event.recurrence
          ? [
              `RRULE:FREQ=WEEKLY;INTERVAL=${event.recurrence.interval};BYDAY=${event.recurrence.weekdays.join(",")};UNTIL=${event.recurrence.until.replace(/-/g, "")}T215959Z`,
            ]
          : undefined,
        reminders: {
          useDefault: false,
          overrides: reminders,
        },
        extendedProperties: {
          private: {
            internalEventId: event.id,
            timetableVersionId: event.timetableVersionId,
          },
        },
      }) satisfies GoogleCalendarEventPayload,
  );
}

export function getGoogleSyncPlan(input: {
  previousContentHashes: Record<string, string>;
  nextContentHashes: Record<string, string>;
}) {
  const create: string[] = [];
  const update: string[] = [];
  const cancel: string[] = [];

  for (const [eventId, hash] of Object.entries(input.nextContentHashes)) {
    if (!input.previousContentHashes[eventId]) create.push(eventId);
    else if (input.previousContentHashes[eventId] !== hash)
      update.push(eventId);
  }

  for (const eventId of Object.keys(input.previousContentHashes)) {
    if (!input.nextContentHashes[eventId]) cancel.push(eventId);
  }

  return { create, update, cancel };
}
