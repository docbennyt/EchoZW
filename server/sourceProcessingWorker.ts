import {
  claimSourceProcessingJob,
  createSourceProcessingRepository,
  markSourceProcessingJobFailed,
} from "./sourceProcessingRepository.js";
import {
  classifySourceProcessingError,
  processSourceSnapshot,
} from "./sourceProcessingService.js";

export type SourceProcessingWorker = {
  stop: () => void;
};

export function startSourceProcessingWorker(
  env: NodeJS.ProcessEnv = process.env,
): SourceProcessingWorker {
  const enabled = env.SOURCE_PROCESSING_WORKER_ENABLED !== "false";
  if (!enabled) return { stop: () => undefined };

  const intervalMs = Number(env.SOURCE_PROCESSING_WORKER_INTERVAL_MS ?? 15000);
  let stopped = false;
  let processing = false;
  let timer: NodeJS.Timeout | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => void tick(), Math.max(intervalMs, 1000));
    timer.unref?.();
  };

  const tick = async () => {
    if (processing || stopped) {
      schedule();
      return;
    }
    processing = true;
    try {
      const job = await claimSourceProcessingJob(env);
      if (job) {
        try {
          await processSourceSnapshot(
            job.snapshotId,
            createSourceProcessingRepository(env),
          );
        } catch (error) {
          await markSourceProcessingJobFailed(
            {
              errorCode: classifySourceProcessingError(error),
              errorMetadata: {
                message: error instanceof Error ? error.message : String(error),
              },
              snapshotId: job.snapshotId,
            },
            env,
          );
        }
      }
    } catch (error) {
      console.warn("source.processing.worker", {
        code: classifySourceProcessingError(error),
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
