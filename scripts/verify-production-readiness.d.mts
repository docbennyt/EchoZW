export type SmokeOptions = {
  origin?: string;
  timetableSlug: string;
  adminBearerToken?: string;
  help?: boolean;
};

export type SmokeResult = {
  origin: string;
  timetableSlug: string;
  ok: boolean;
  results: Array<{
    route: string;
    status: number;
    ok: boolean;
    mode?: "authenticated" | "unauthenticated";
  }>;
};

export function parseArgs(
  argv?: string[],
  env?: NodeJS.ProcessEnv,
): SmokeOptions;

export function runReadinessSmoke(
  options: SmokeOptions,
  fetchImpl?: typeof fetch,
): Promise<SmokeResult>;

export function formatSmokeResult(result: SmokeResult): string;
