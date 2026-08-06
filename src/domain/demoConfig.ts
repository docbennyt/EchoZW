type DemoEnv = {
  ALLOW_DEMO_DATA?: string;
  APP_ENV?: string;
  NODE_ENV?: string;
};

export function isDemoDataAllowed(
  env: DemoEnv,
  runtimeMode: "development" | "production" = "development",
) {
  if (runtimeMode === "production") return false;
  if (env.APP_ENV === "production" || env.NODE_ENV === "production") {
    return false;
  }

  return env.ALLOW_DEMO_DATA === "true";
}
