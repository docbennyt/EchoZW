export const HIT_TIMETABLE_SOURCE_KEY = "hit-sist-master-sem1-2026";
export const HIT_TIMETABLE_PARSER_PROFILE = "hit_sist_master_v1";
export const HIT_TIMETABLE_RELAY_SECRET_ENV_NAME = "HIT_TIMETABLE_RELAY_SECRET";

export type SourceSnapshotEnv = {
  HIT_TIMETABLE_RELAY_SECRET?: string;
} & Record<string, string | undefined>;

export type SourceSecretConfig = {
  relaySecretEnvName?: string | null;
  sourceKey: string;
};

export function normalizeRelaySecret(secret: string | undefined) {
  const effective = secret?.trim() ?? "";
  return effective.length > 0 ? effective : undefined;
}

export function getRelaySecretForSourceKey(
  sourceKey: string,
  env: SourceSnapshotEnv = process.env,
) {
  switch (sourceKey) {
    case HIT_TIMETABLE_SOURCE_KEY:
      return normalizeRelaySecret(env[HIT_TIMETABLE_RELAY_SECRET_ENV_NAME]);
    default:
      return undefined;
  }
}

export function getRelaySecretForSource(
  source: SourceSecretConfig,
  env: SourceSnapshotEnv = process.env,
) {
  const envName = source.relaySecretEnvName?.trim();
  if (envName) return normalizeRelaySecret(env[envName]);
  return getRelaySecretForSourceKey(source.sourceKey, env);
}
