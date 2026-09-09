export type ServiceWorkerReadiness =
  | { status: "unsupported" }
  | { status: "insecure" }
  | { status: "registered"; registration: ServiceWorkerRegistration }
  | { status: "failed"; errorCode: "registration_failed" };

let registrationPromise: Promise<ServiceWorkerReadiness> | null = null;

function canRegisterServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return "unsupported" as const;
  }
  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    return "insecure" as const;
  }
  return "supported" as const;
}

export function registerCalenderZwServiceWorker(): Promise<ServiceWorkerReadiness> {
  if (registrationPromise) return registrationPromise;

  const capability = canRegisterServiceWorker();
  if (capability !== "supported") {
    registrationPromise = Promise.resolve({ status: capability });
    return registrationPromise;
  }

  registrationPromise = navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then(async (registration) => {
      // Check for an updated worker without forcing an active tab to reload.
      try {
        await registration.update();
      } catch {
        // The current registration remains usable when an update check fails.
      }
      return { status: "registered", registration } as const;
    })
    .catch(
      () => ({ status: "failed", errorCode: "registration_failed" }) as const,
    );

  return registrationPromise;
}

export async function activateWaitingServiceWorker() {
  const readiness = await registerCalenderZwServiceWorker();
  if (readiness.status !== "registered" || !readiness.registration.waiting) {
    return false;
  }
  readiness.registration.waiting.postMessage({ type: "SKIP_WAITING" });
  return true;
}
