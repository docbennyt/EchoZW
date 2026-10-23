export function obtainAcceptanceToken(
  env: Record<string, string | undefined>,
  request?: typeof fetch,
): Promise<string | null>;
export function validateRecoveryCalendar(
  text: string,
  onFailure?: (code: string, count?: number) => void,
): boolean;
