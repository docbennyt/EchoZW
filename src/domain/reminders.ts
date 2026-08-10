import type { ReminderPreset } from "./types.js";

export const supportedReminderMinutes = [5, 10, 15, 30, 45, 60, 120, 720, 1440];

export const reminderPresets: ReminderPreset[] = [
  {
    id: "prepared",
    label: "Prepared",
    description: "24 hours and 30 minutes before each lecture.",
    minutes: [1440, 30],
  },
  {
    id: "on_time",
    label: "On time",
    description: "30 minutes before each lecture.",
    minutes: [30],
  },
  {
    id: "commuter",
    label: "Commuter",
    description: "60 minutes and 15 minutes before each lecture.",
    minutes: [60, 15],
  },
  {
    id: "custom",
    label: "Custom",
    description: "Choose from safe reminder options.",
    minutes: [45, 10],
  },
];

export function validateReminderMinutes(minutes: number[]) {
  const unique = [...new Set(minutes)].sort((a, b) => b - a);
  if (unique.length === 0 || unique.length > 5) {
    throw new Error("Choose one to five reminders.");
  }
  for (const minute of unique) {
    if (!Number.isInteger(minute) || minute <= 0 || minute > 10080) {
      throw new Error(`Unsupported reminder value: ${minute}`);
    }
  }
  return unique;
}
