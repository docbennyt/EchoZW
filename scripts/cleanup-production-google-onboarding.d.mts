export function cleanupProductionGoogleOnboarding(
  env: Record<string, string | undefined>,
  request?: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<{
  removed: true;
  workerVersion: string;
  alreadyAbsent?: true;
}>;
