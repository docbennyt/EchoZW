import { cleanupEligibleStaticTimetableRawSources } from "./staticTimetableRawCleanup.js";

export type StaticTimetableRawCleanupWorker = { stop: () => void };

export function startStaticTimetableRawCleanupWorker(
  env: NodeJS.ProcessEnv = process.env,
): StaticTimetableRawCleanupWorker {
  if (env.STATIC_TIMETABLE_RAW_CLEANUP_WORKER_ENABLED === "false") {
    return { stop: () => undefined };
  }

  const intervalMs = Math.max(
    Number(env.STATIC_TIMETABLE_RAW_CLEANUP_INTERVAL_MS ?? 60 * 60 * 1000),
    60_000,
  );
  const limit = Math.max(
    1,
    Math.min(Number(env.STATIC_TIMETABLE_RAW_CLEANUP_BATCH_SIZE ?? 25), 100),
  );
  let stopped = false;
  let processing = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), intervalMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (processing || stopped) {
      schedule();
      return;
    }
    processing = true;
    try {
      const result = await cleanupEligibleStaticTimetableRawSources({
        env,
        limit,
      });
      if (result.deleted > 0 || result.failed > 0) {
        console.info("static.timetable.raw_cleanup", {
          deleted: result.deleted,
          failed: result.failed,
          inspected: result.inspected,
          skipped: result.skipped,
        });
      }
    } catch (error) {
      console.warn("static.timetable.raw_cleanup.failed", {
        code:
          error instanceof Error
            ? error.message.split(":")[0]
            : "STATIC_IMPORT_RAW_CLEANUP_FAILED",
      });
    } finally {
      processing = false;
      schedule();
    }
  };

  void tick();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
