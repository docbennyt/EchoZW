export type AdminSessionUser = {
  id: string;
  email: string | null;
};

export type AdminSessionResponse = {
  authenticated: true;
  admin: true;
  user: AdminSessionUser;
};

export async function fetchAdminSession(accessToken: string) {
  const response = await fetch("/api/admin/session", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | AdminSessionResponse
    | { error?: { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    const error = new Error(
      body && "error" in body && body.error?.message
        ? body.error.message
        : "Administrator sign-in is required.",
    );
    error.name =
      body && "error" in body && body.error?.code
        ? body.error.code
        : "AUTH_REQUIRED";
    throw error;
  }

  return body as AdminSessionResponse;
}
