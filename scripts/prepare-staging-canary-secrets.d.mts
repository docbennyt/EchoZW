export function prepareCanarySecrets(
  raw: unknown,
  candidateSha: string | undefined,
  selectedBindingPresent: boolean,
  now?: number,
): Record<string, string>;

export function selectedCanaryBindingPresent(
  env: Record<string, string | undefined>,
  request?: typeof fetch,
): Promise<boolean>;
