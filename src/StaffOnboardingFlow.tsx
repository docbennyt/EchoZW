import { Button as BaseButton } from "@base-ui/react/button";
import { CheckCircle2, Download, Share2, Smartphone } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "./analytics";
import type { ResolvedStaffOnboarding } from "./domain/staffOnboarding";
import {
  getInstallCapability,
  requestAppInstall,
  subscribeInstallCapability,
  type AppInstallCapability,
  type AppInstallResult,
} from "./pwa/installCapability";
import "./staffOnboardingFlow.css";

type InstallAdapter = {
  getCapability: () => AppInstallCapability;
  requestInstall: () => Promise<AppInstallResult>;
  subscribe: (listener: () => void) => () => void;
};

type StaffOnboardingFlowProps = {
  resolved: ResolvedStaffOnboarding;
  installAdapter?: InstallAdapter;
  navigate?: (path: string) => void;
};

const defaultInstallAdapter: InstallAdapter = {
  getCapability: getInstallCapability,
  requestInstall: requestAppInstall,
  subscribe: subscribeInstallCapability,
};

function defaultNavigate(path: string) {
  window.location.assign(path);
}

function capabilityCopy(capability: AppInstallCapability) {
  if (capability === "ios_manual") {
    return {
      title: "Add CalenderZW to your Home Screen",
      body: "On iPhone or iPad, use Safari's Share menu, choose Add to Home Screen, then open CalenderZW from the new Home Screen icon.",
    };
  }
  if (capability === "unsupported") {
    return {
      title: "Your workspace is still ready",
      body: "This browser cannot offer app installation here. You can continue securely in the browser with the same server-authorized access.",
    };
  }
  return {
    title: "Install CalenderZW",
    body: "Use CalenderZW like an app on this device for faster access to your work. Installation changes the device experience, not your permissions.",
  };
}

export function StaffOnboardingFlow({
  resolved,
  installAdapter = defaultInstallAdapter,
  navigate = defaultNavigate,
}: StaffOnboardingFlowProps) {
  const [capability, setCapability] = useState<AppInstallCapability>(() =>
    installAdapter.getCapability(),
  );
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [resultMessage, setResultMessage] = useState("");
  const trackedOffer = useRef(false);
  const redirectedInstalled = useRef(false);

  const finish = useCallback(
    (status: string) => {
      track("staff_onboarding_completed", {
        mode: resolved.role,
        status,
      });
      navigate(resolved.destination);
    },
    [navigate, resolved.destination, resolved.role],
  );

  useEffect(() => {
    track("staff_signup_completed", {
      mode: resolved.role,
      status: "server_authorized",
    });
  }, [resolved.role]);

  useEffect(() => {
    const refresh = () => setCapability(installAdapter.getCapability());
    const unsubscribe = installAdapter.subscribe(refresh);
    refresh();
    return unsubscribe;
  }, [installAdapter]);

  useEffect(() => {
    if (capability === "installed") {
      if (redirectedInstalled.current) return;
      redirectedInstalled.current = true;
      track("staff_install_detected", {
        mode: resolved.role,
        status: "installed",
      });
      finish("installed");
      return;
    }
    if (!trackedOffer.current) {
      trackedOffer.current = true;
      track("staff_install_offer_viewed", {
        mode: resolved.role,
        status: capability,
      });
    }
  }, [capability, finish, resolved.role]);

  async function install() {
    if (busy || capability !== "promptable") return;
    setBusy(true);
    setResultMessage("");
    track("staff_install_clicked", {
      mode: resolved.role,
      status: capability,
    });
    try {
      const result = await installAdapter.requestInstall();
      track("staff_install_result", {
        mode: resolved.role,
        status: result,
      });
      if (result === "accepted" || result === "already_installed") {
        finish(result);
        return;
      }
      if (result === "dismissed") {
        setDismissed(true);
        setResultMessage(
          "Installation was dismissed. Your staff access is unchanged; continue in the browser whenever you're ready.",
        );
      } else if (result === "manual_required") {
        setCapability("ios_manual");
      } else {
        setCapability("unsupported");
      }
    } finally {
      setBusy(false);
    }
  }

  const copy = capabilityCopy(capability);
  const showInstallButton = capability === "promptable" && !dismissed;

  return (
    <section
      className="staff-onboarding"
      aria-labelledby="staff-onboarding-title"
      data-role={resolved.role}
    >
      <div className="staff-onboarding-progress" aria-label="Signup progress">
        <span className="is-complete">1</span>
        <span className="staff-onboarding-progress-line" />
        <span className="is-current">2</span>
        <span className="staff-onboarding-progress-line" />
        <span>3</span>
      </div>

      <div className="staff-onboarding-role">
        <CheckCircle2 aria-hidden="true" size={22} />
        <div>
          <span>Role confirmed by CalenderZW</span>
          <strong>{resolved.roleLabel}</strong>
        </div>
      </div>
      <p className="staff-onboarding-summary">{resolved.summary}</p>

      <div className="staff-onboarding-install">
        <div className="staff-onboarding-install-icon" aria-hidden="true">
          {capability === "ios_manual" ? (
            <Share2 size={24} />
          ) : capability === "unsupported" ? (
            <Smartphone size={24} />
          ) : (
            <Download size={24} />
          )}
        </div>
        <div>
          <span className="czw-eyebrow">App setup</span>
          <h2 id="staff-onboarding-title">{copy.title}</h2>
          <p>{copy.body}</p>
        </div>
      </div>

      {capability === "ios_manual" ? (
        <ol className="staff-onboarding-ios-steps">
          <li>Open this page in Safari.</li>
          <li>Tap Share.</li>
          <li>Choose Add to Home Screen, then open CalenderZW from there.</li>
        </ol>
      ) : null}

      {resultMessage ? (
        <p className="staff-onboarding-result" role="status">
          {resultMessage}
        </p>
      ) : null}

      <div className="staff-onboarding-actions">
        {showInstallButton ? (
          <BaseButton
            className="czw-button czw-button-primary"
            disabled={busy}
            onClick={() => void install()}
            type="button"
          >
            <Download size={17} />
            {busy ? "Opening install..." : "Install CalenderZW"}
          </BaseButton>
        ) : null}
        <BaseButton
          className={
            showInstallButton
              ? "czw-button staff-onboarding-secondary"
              : "czw-button czw-button-primary"
          }
          onClick={() =>
            finish(capability === "ios_manual" ? "manual" : "browser")
          }
          type="button"
        >
          {capability === "ios_manual"
            ? "Continue in browser"
            : "Continue to workspace"}
        </BaseButton>
      </div>

      <p className="staff-onboarding-security-note">
        Your permissions come from your CalenderZW staff account. Installing or
        skipping the app cannot grant, remove, or expand access.
      </p>
    </section>
  );
}
