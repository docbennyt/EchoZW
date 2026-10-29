type Consumer = {
  queue: string;
  max_retries?: number;
  max_batch_size?: number;
  max_concurrency?: number;
};
export function prepareProductionConfiguration(
  input: Record<string, unknown>,
): Record<string, unknown> & {
  main: string;
  assets: { directory: string };
  no_bundle: true;
  env: {
    production: {
      routes: Array<{ pattern: string; custom_domain: boolean }>;
      vars: Record<string, string>;
      triggers: { crons: string[] };
      queues: { consumers: Consumer[] };
    };
  };
};
export function assertProductionRuntimeConfiguration(
  trusted: Record<string, unknown>,
  candidate: Record<string, unknown>,
): string;
