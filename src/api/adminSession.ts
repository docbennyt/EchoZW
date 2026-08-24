export type AdminSessionUser = {
  id: string;
  email: string | null;
};

export type AdminSessionResponse = {
  authenticated: true;
  admin: true;
  user: AdminSessionUser;
};

function isAdminSessionResponse(value: unknown): value is AdminSessionResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AdminSessionResponse>;
  return (
    candidate.authenticated === true &&
    candidate.admin === true &&
    Boolean(candidate.user) &&
    typeof candidate.user?.id === "string" &&
    (typeof candidate.user?.email === "string" ||
      candidate.user?.email === null)
  );
}

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

  if (!isAdminSessionResponse(body)) {
    const error = new Error(
      "Administrator session verification returned an invalid response.",
    );
    error.name = "INVALID_ADMIN_SESSION";
    throw error;
  }

  return body;
}
