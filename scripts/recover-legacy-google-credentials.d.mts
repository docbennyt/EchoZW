export function runLegacyGoogleCredentialRecovery(
  env: NodeJS.ProcessEnv,
  dependencies?: {
    request?: typeof fetch;
    pause?: (milliseconds: number) => Promise<void>;
  },
): Promise<Record<string, unknown>>;
