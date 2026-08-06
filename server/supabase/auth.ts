import type { IncomingMessage, ServerResponse } from "node:http";
import { createSupabaseAdminClient } from "./adminClient.js";
import { createSupabaseUserClient } from "./userClient.js";

export type AdminAuthErrorCode =
  | "AUTH_REQUIRED"
  | "FORBIDDEN"
  | "AUTH_CONFIGURATION_ERROR"
  | "DATABASE_UNAVAILABLE";

export class AdminAuthError extends Error {
  constructor(
    public readonly code: AdminAuthErrorCode,
    message: string,
    public readonly status: 401 | 403 | 500 | 503,
  ) {
    super(message);
  }
}

export type AuthenticatedUser = {
  id: string;
  email: string | null;
};

type SupabaseUserShape = {
  id: string;
  email?: string | null;
};

type UserLookupClient = {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: SupabaseUserShape | null };
      error: unknown;
    }>;
  };
};

type AdminLookupClient = {
  from: (table: "admin_users") => {
    select: (columns: string) => {
      eq: (
        column: "user_id",
        value: string,
      ) => {
        maybeSingle: () => Promise<{
          data: { user_id?: string; active?: boolean } | null;
          error: unknown;
        }>;
      };
    };
  };
};

export type AuthDependencies = {
  createUserClient?: (accessToken: string) => UserLookupClient;
  createAdminClient?: () => AdminLookupClient;
};

function extractBearerToken(req: IncomingMessage) {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "Administrator sign-in is required.",
      401,
    );
  }

  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  if (!match?.[1]) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "Administrator sign-in is required.",
      401,
    );
  }

  return match[1];
}

function normalizeUser(user: SupabaseUserShape): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email ?? null,
  };
}

export async function requireAuthenticatedUser(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<AuthenticatedUser> {
  const token = extractBearerToken(req);
  let userClient: UserLookupClient;
  try {
    userClient =
      deps.createUserClient?.(token) ??
      (createSupabaseUserClient(token) as unknown as UserLookupClient);
  } catch {
    throw new AdminAuthError(
      "AUTH_CONFIGURATION_ERROR",
      "Administrator authentication is not configured.",
      500,
    );
  }

  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data.user) {
    throw new AdminAuthError(
      "AUTH_REQUIRED",
      "Administrator sign-in is required.",
      401,
    );
  }

  return normalizeUser(data.user);
}

export async function requireAdmin(
  req: IncomingMessage,
  deps: AuthDependencies = {},
): Promise<AuthenticatedUser> {
  const user = await requireAuthenticatedUser(req, deps);
  let adminClient: AdminLookupClient;
  try {
    adminClient =
      deps.createAdminClient?.() ??
      (createSupabaseAdminClient() as unknown as AdminLookupClient);
  } catch {
    throw new AdminAuthError(
      "AUTH_CONFIGURATION_ERROR",
      "Administrator authorization is not configured.",
      500,
    );
  }

  const { data, error } = await adminClient
    .from("admin_users")
    .select("user_id, active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new AdminAuthError(
      "DATABASE_UNAVAILABLE",
      "Administrator authorization is temporarily unavailable.",
      503,
    );
  }

  if (!data?.active) {
    throw new AdminAuthError(
      "FORBIDDEN",
      "This account does not have administrator access.",
      403,
    );
  }

  return user;
}

export function sendAdminAuthError(res: ServerResponse, error: unknown) {
  const authError =
    error instanceof AdminAuthError
      ? error
      : new AdminAuthError(
          "DATABASE_UNAVAILABLE",
          "Administrator authorization is temporarily unavailable.",
          503,
        );

  res.writeHead(authError.status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(
    JSON.stringify({
      error: {
        code: authError.code,
        message: authError.message,
      },
    }),
  );
}
