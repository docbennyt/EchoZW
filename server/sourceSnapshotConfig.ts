export const HIT_TIMETABLE_SOURCE_KEY = "hit-sist-master-sem1-2026";

export type SourceSnapshotEnv = {
  HIT_TIMETABLE_RELAY_SECRET?: string;
};

export function getRelaySecretForSourceKey(
  sourceKey: string,
  env: SourceSnapshotEnv = process.env,
) {
  switch (sourceKey) {
    case HIT_TIMETABLE_SOURCE_KEY:
      return env.HIT_TIMETABLE_RELAY_SECRET?.trim() || undefined;
    default:
      return undefined;
  }
}
