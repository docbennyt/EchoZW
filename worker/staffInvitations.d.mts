/** Adapts existing staff lifecycle handlers with manager and founder guards. */
export function handleNativeStaffInvitation(
  request: Request,
  env: NodeJS.ProcessEnv,
): Promise<Response | null>;
