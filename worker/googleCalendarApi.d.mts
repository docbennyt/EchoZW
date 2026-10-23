type GoogleSyncTarget = { subscriptionId: string; timetableId: string };
type EnqueueGoogleSync = (
  target: GoogleSyncTarget,
  env: NodeJS.ProcessEnv,
) => Promise<void>;

export function handleGoogleCalendarRequest(
  request: Request,
  env: NodeJS.ProcessEnv,
  options?: {
    deliveryEnabled?: boolean;
    enqueueInitialSync?: EnqueueGoogleSync;
    enqueueReconciliation?: EnqueueGoogleSync;
  },
): Promise<Response | null>;
