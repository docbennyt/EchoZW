export function runLegacyGoogleCredentialRecovery(
  env: NodeJS.ProcessEnv,
  dependencies?: { request?: typeof fetch },
): Promise<Record<string, unknown>>;
