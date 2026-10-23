type Consumer = {
  queue: string;
  max_retries?: number;
  max_batch_size?: number;
  max_concurrency?: number;
};
type PreparedStagingConfiguration = {
  compatibility_date?: string;
  compatibility_flags: string[];
  main: string;
  assets: { directory: string };
  no_bundle: true;
  vars: Record<string, string>;
  env: {
    staging: {
      vars: Record<string, string>;
      routes: unknown;
      triggers: { crons: string[] };
      queues: { consumers: Consumer[] };
    };
  };
  observability: {
    logs: { invocation_logs: boolean };
    traces: { enabled: boolean };
  };
  [key: string]: unknown;
};
export function prepareStagingConfiguration(
  input: Record<string, unknown>,
): PreparedStagingConfiguration;
export function assertCandidateRuntimeConfiguration(
  trusted: Record<string, unknown>,
  candidate: Record<string, unknown>,
): string;
