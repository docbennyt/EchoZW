import { getServerSupabaseConfig, type ServerSupabaseEnv } from "./config.js";

export type SupabaseConnectivityResult = {
  configured: boolean;
  reachable: boolean;
  projectHost?: string;
  authConfigured: boolean;
  status:
    | "CONFIGURATION_MISSING"
    | "INVALID_CONFIGURATION"
    | "NETWORK_ERROR"
    | "INVALID_PUBLISHABLE_KEY"
    | "PROJECT_REACHABLE";
};

export async function checkSupabaseConnectivity(
  env: ServerSupabaseEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<SupabaseConnectivityResult> {
  let config;
  try {
    config = getServerSupabaseConfig(env);
  } catch {
    return {
      configured: false,
      reachable: false,
      authConfigured: false,
      status: "CONFIGURATION_MISSING",
    };
  }

  try {
    const response = await fetchImpl(`${config.url}/auth/v1/settings`, {
      headers: {
        apikey: config.publishableKey,
      },
    });

    if (response.status === 401 || response.status === 403) {
      return {
        configured: true,
        reachable: true,
        projectHost: config.projectHost,
        authConfigured: false,
        status: "INVALID_PUBLISHABLE_KEY",
      };
    }

    return {
      configured: true,
      reachable: response.ok,
      projectHost: config.projectHost,
      authConfigured: response.ok,
      status: response.ok ? "PROJECT_REACHABLE" : "NETWORK_ERROR",
    };
  } catch {
    return {
      configured: true,
      reachable: false,
      projectHost: config.projectHost,
      authConfigured: false,
      status: "NETWORK_ERROR",
    };
  }
}
