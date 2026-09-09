export type AppInstallCapability =
  "installed" | "promptable" | "ios_manual" | "unsupported";

export type AppInstallResult =
  | "accepted"
  | "dismissed"
  | "already_installed"
  | "manual_required"
  | "unavailable";

type BeforeInstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
};

type InstallEnvironment = {
  userAgent: string;
  maxTouchPoints: number;
  standaloneMediaMatches: boolean;
  navigatorStandalone: boolean;
};

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let initialized = false;
const listeners = new Set<() => void>();

export function isIosOrIpadOs(userAgent: string, maxTouchPoints = 0): boolean {
  return (
    /iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  );
}

export function detectInstallCapability(
  environment: InstallEnvironment,
  promptAvailable: boolean,
): AppInstallCapability {
  if (environment.standaloneMediaMatches || environment.navigatorStandalone) {
    return "installed";
  }
  if (promptAvailable) return "promptable";
  if (isIosOrIpadOs(environment.userAgent, environment.maxTouchPoints)) {
    return "ios_manual";
  }
  return "unsupported";
}

function browserEnvironment(): InstallEnvironment {
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standaloneMediaMatches:
      typeof window.matchMedia === "function" &&
      window.matchMedia("(display-mode: standalone)").matches,
    navigatorStandalone: navigatorWithStandalone.standalone === true,
  };
}

function emitChange() {
  for (const listener of listeners) listener();
}

export function initializeInstallExperience() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emitChange();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    emitChange();
  });
}

export function subscribeInstallCapability(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallCapability(): AppInstallCapability {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return "unsupported";
  }
  return detectInstallCapability(browserEnvironment(), deferredPrompt !== null);
}

export async function requestAppInstall(): Promise<AppInstallResult> {
  const capability = getInstallCapability();
  if (capability === "installed") return "already_installed";
  if (capability === "ios_manual") return "manual_required";
  if (capability !== "promptable" || !deferredPrompt) return "unavailable";

  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  emitChange();
  return choice.outcome;
}
