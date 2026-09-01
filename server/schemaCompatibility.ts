import {
  getServerSupabaseConfig,
  type ServerSupabaseEnv,
} from "./supabase/config.js";

export type SchemaCompatibilityStatus = "ok" | "incompatible" | "unavailable";

export type SchemaCompatibilityResult = {
  status: SchemaCompatibilityStatus;
  requiredCount: number;
  failures: Array<{ object: string; code: string }>;
};

type RequiredRestProbe = {
  object: string;
  path: string;
};

const REQUIRED_SCHEMA_PROBES: RequiredRestProbe[] = [
  {
    object: "staff_users.email",
    path: "/rest/v1/staff_users?select=email&limit=0",
  },
  {
    object: "class_rep_assignments",
    path: "/rest/v1/class_rep_assignments?select=id&limit=0",
  },
  {
    object: "timetable_correction_directives",
    path: "/rest/v1/timetable_correction_directives?select=id&limit=0",
  },
  {
    object: "timetable_session_exceptions.correction fields",
    path: "/rest/v1/timetable_session_exceptions?select=timetable_id,stable_session_key,exception_date,starts_at,ends_at,cancelled,active,creator_staff_user_id&limit=0",
  },
  {
    object: "subscriber_profiles",
    path: "/rest/v1/subscriber_profiles?select=id&limit=0",
  },
  {
    object: "calendar_subscriptions.subscriber_profile_id",
    path: "/rest/v1/calendar_subscriptions?select=subscriber_profile_id&limit=0",
  },
  {
    object: "create_calendar_subscription_with_profile RPC",
    path: "/rest/v1/rpc/create_calendar_subscription_with_profile",
  },
];

function statusCodeForProbe(response: Response) {
  if (response.ok || response.status === 204 || response.status === 405) {
    return null;
  }
  if (response.status === 404 || response.status === 400) {
    return "MISSING_OR_INCOMPATIBLE";
  }
  return "UNAVAILABLE";
}

export async function checkSchemaCompatibility(
  env: ServerSupabaseEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SchemaCompatibilityResult> {
  let config;
  try {
    config = getServerSupabaseConfig(env);
  } catch {
    return {
      status: "unavailable",
      requiredCount: REQUIRED_SCHEMA_PROBES.length,
      failures: [{ object: "supabase", code: "CONFIGURATION_MISSING" }],
    };
  }

  const headers = {
    apikey: config.publishableKey,
    Authorization: `Bearer ${config.privilegedKey ?? config.publishableKey}`,
  };
  const failures: SchemaCompatibilityResult["failures"] = [];

  for (const probe of REQUIRED_SCHEMA_PROBES) {
    try {
      const method = probe.path.includes("/rpc/") ? "OPTIONS" : "HEAD";
      const response = await fetchImpl(`${config.url}${probe.path}`, {
        method,
        headers,
      });
      const code = statusCodeForProbe(response);
      if (code) failures.push({ object: probe.object, code });
    } catch {
      failures.push({ object: probe.object, code: "NETWORK_ERROR" });
    }
  }

  const unavailable = failures.some(
    (failure) =>
      failure.code === "UNAVAILABLE" || failure.code === "NETWORK_ERROR",
  );
  return {
    status:
      failures.length === 0
        ? "ok"
        : unavailable
          ? "unavailable"
          : "incompatible",
    requiredCount: REQUIRED_SCHEMA_PROBES.length,
    failures,
  };
}
