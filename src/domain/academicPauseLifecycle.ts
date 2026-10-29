export type PauseLifecycle = "current" | "scheduled" | "ended" | "disabled";

export function pauseLifecycle(
  pause: { active: boolean; startsOn: string; endsOn: string },
  today: string,
): PauseLifecycle {
  if (!pause.active) return "disabled";
  if (pause.endsOn < today) return "ended";
  if (pause.startsOn > today) return "scheduled";
  return "current";
}
