/** Adapts manager GET /staff and founder-only POST /staff/invite-admin. */
export function handleNativeStaffInvitation(
  request: Request,
  env: NodeJS.ProcessEnv,
): Promise<Response | null>;
