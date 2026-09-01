export type CalenderZwRuntimeConfig = {
  supabaseUrl?: string;
  supabasePublishableKey?: string;
  publicAppUrl?: string;
  releaseSha?: string;
};

declare global {
  interface Window {
    __CALENDERZW_RUNTIME_CONFIG__?: CalenderZwRuntimeConfig;
  }
}

export function getBrowserRuntimeConfig(): CalenderZwRuntimeConfig | undefined {
  return typeof window === "undefined"
    ? undefined
    : window.__CALENDERZW_RUNTIME_CONFIG__;
}
