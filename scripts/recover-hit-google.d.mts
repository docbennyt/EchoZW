export type RecoverySelection = {
  subscriptionId: string;
  timetableId: string;
  ownerId: string;
  status: "active" | "failed";
  desiredRevision: number;
  connectionGeneration: number;
  mappingCount: number;
  lastSyncedAt: string | null;
};
export function parseRecoveryPlan(
  raw: string | undefined,
  sha: string | undefined,
  now?: number,
): {
  candidateSha: string;
  expiresAt: string;
  subscriptions: RecoverySelection[];
};
export function previewIsSafe(value: unknown): boolean;
export function runGoogleRecovery(
  env: Record<string, string | undefined>,
  dependencies?: {
    request?: typeof fetch;
    delay?: (ms: number) => Promise<void>;
  },
): Promise<{
  mode: string;
  sourceSha: string;
  results: Record<string, unknown>[];
  identityVerified?: boolean;
  recoveryAuthorizationAbsent?: boolean;
}>;
