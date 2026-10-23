export function verifyStagingIdentity(
  env: Record<string, string | undefined>,
  request?: typeof fetch,
): Promise<{
  sourceSha: string;
  runtime: string;
  legacyBackendBridge: boolean;
  workerVersion: string;
}>;
