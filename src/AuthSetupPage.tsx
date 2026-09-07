import { Button as BaseButton } from "@base-ui/react/button";
import { Input as BaseInput } from "@base-ui/react/input";
import { Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  AUTH_CONFIRM_PATH,
  authSetupIntentFromUrl,
  INVITE_INVALID_MESSAGE,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RESET_INVALID_MESSAGE,
  PASSWORD_RESET_PATH,
  restoreAuthSessionFromRedirect,
  safeAuthNextPath,
  type AuthSetupIntent,
  validateNewPassword,
} from "./authRecovery";
import {
  browserAuthFailureCode,
  trackBrowserAuthFailure,
} from "./authDiagnostics";
import { createClient as createSupabaseBrowserClient } from "./utils/supabase/client";

const currentPath = () => window.location.pathname;

type SetupStatus =
  | "checking"
  | "ready"
  | "updating"
  | "success"
  | "invalid"
  | "error";

function setAuthPageMetadata(path: string) {
  document.title =
    path === AUTH_CONFIRM_PATH
      ? "Completing account setup | CalenderZW"
      : "Set your CalenderZW password";
  let robots = document.head.querySelector<HTMLMetaElement>(
    'meta[name="robots"]',
  );
  if (!robots) {
    robots = document.createElement("meta");
    robots.setAttribute("name", "robots");
    document.head.append(robots);
  }
  robots.setAttribute("content", "noindex, nofollow");
}

function setupCopy(intent: AuthSetupIntent) {
  if (intent === "invite") {
    return {
      eyebrow: "CalenderZW Class Rep",
      title: "Finish setting up your account.",
      body: "Create a password to manage your assigned class timetable.",
      action: "Create password",
      updating: "Creating password...",
      success: "Your CalenderZW account is ready.",
      invalid: INVITE_INVALID_MESSAGE,
    };
  }
  return {
    eyebrow: "Account recovery",
    title: "Choose a new password.",
    body: "Set a new password for your CalenderZW account.",
    action: "Update password",
    updating: "Updating password...",
    success: "Password updated.",
    invalid: PASSWORD_RESET_INVALID_MESSAGE,
  };
}

export function AuthSetupPage() {
  const initialUrl = new URL(window.location.href);
  const [intent, setIntent] = useState<AuthSetupIntent>(() =>
    authSetupIntentFromUrl(
      initialUrl,
      currentPath() === PASSWORD_RESET_PATH ? "recovery" : "unknown",
    ),
  );
  const [status, setStatus] = useState<SetupStatus>("checking");
  const [message, setMessage] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const supabaseRef = useRef<ReturnType<
    typeof createSupabaseBrowserClient
  > | null>(null);

  useEffect(() => {
    setAuthPageMetadata(currentPath());
  }, []);

  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);

  useEffect(() => {
    let active = true;

    async function completeSetupRedirect() {
      const url = new URL(window.location.href);
      const fallbackIntent =
        currentPath() === PASSWORD_RESET_PATH ? "recovery" : "unknown";
      let supabase;
      try {
        supabase = createSupabaseBrowserClient();
        supabaseRef.current = supabase;
      } catch (error) {
        trackBrowserAuthFailure({
          code: browserAuthFailureCode(error),
          path: currentPath(),
        });
        if (!active) return;
        setStatus("error");
        setMessage("Account setup is temporarily unavailable. Please try again.");
        return;
      }

      const result = await restoreAuthSessionFromRedirect(supabase.auth, url, {
        fallbackIntent,
        sanitize: () =>
          window.history.replaceState({}, "", currentPath()),
      });
      if (!active) return;

      if (!result.ok) {
        trackBrowserAuthFailure({ code: result.code, path: currentPath() });
        setIntent(result.intent);
        setStatus("invalid");
        setMessage(setupCopy(result.intent).invalid);
        return;
      }

      setIntent(result.intent);

      if (currentPath() === AUTH_CONFIRM_PATH) {
        const next = safeAuthNextPath(url.searchParams.get("next"));
        const target =
          next === PASSWORD_RESET_PATH
            ? `${PASSWORD_RESET_PATH}?intent=${result.intent}`
            : next;
        window.location.replace(target);
        return;
      }

      setStatus("ready");
      setMessage("");
      passwordRef.current?.focus();
    }

    void completeSetupRedirect();
    return () => {
      active = false;
    };
  }, []);

  async function submitPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validationMessage = validateNewPassword(password, confirmation);
    if (validationMessage) {
      setStatus("ready");
      setMessage(validationMessage);
      return;
    }

    const supabase = supabaseRef.current;
    if (!supabase) {
      setStatus("error");
      setMessage("Account setup is temporarily unavailable. Please try again.");
      return;
    }

    setStatus("updating");
    setMessage("");
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setStatus("error");
      setMessage(
        intent === "invite"
          ? "We could not create your password. Ask the administrator to resend the invitation."
          : "We could not update the password. Request a new reset link.",
      );
      return;
    }

    setPassword("");
    setConfirmation("");
    setStatus("success");
    setMessage(setupCopy(intent).success);
  }

  const copy = setupCopy(intent);
  const showForm =
    status === "ready" || status === "updating" || status === "success" || status === "error";

  return (
    <div className="czw-app-shell">
      <header className="czw-header" data-component="AuthHeader">
        <div className="czw-shell czw-nav-row">
          <a className="czw-brand" href="/" aria-label="CalenderZW home">
            <span className="czw-wordmark">
              Calender<span>ZW</span>
            </span>
          </a>
        </div>
      </header>
      <main className="czw-auth-page">
        <section className="czw-auth-card" aria-labelledby="auth-setup-title">
          <div className="czw-auth-icon">
            <Lock size={22} />
          </div>
          <span className="czw-eyebrow">{copy.eyebrow}</span>
          <h1 id="auth-setup-title">{copy.title}</h1>
          <p>{copy.body}</p>

          {status === "checking" ? (
            <p className="czw-auth-message" role="status">
              Completing account setup...
            </p>
          ) : null}

          {status === "invalid" ? (
            <>
              <p
                className="czw-auth-message"
                ref={messageRef}
                role="alert"
                tabIndex={-1}
              >
                {message}
              </p>
              {intent === "recovery" ? (
                <a className="czw-button czw-button-primary" href="/admin/login">
                  Request another reset
                </a>
              ) : null}
            </>
          ) : null}

          {showForm && status !== "success" ? (
            <form onSubmit={submitPassword}>
              <label>
                <span>New password</span>
                <BaseInput
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  name="new-password"
                  ref={passwordRef}
                  required
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label>
                <span>Confirm new password</span>
                <BaseInput
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  name="confirm-password"
                  required
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                />
              </label>
              <BaseButton
                className="czw-button czw-button-primary"
                disabled={status === "updating"}
                type="submit"
              >
                <Lock size={17} />
                {status === "updating" ? copy.updating : copy.action}
              </BaseButton>
            </form>
          ) : null}

          {message && status !== "invalid" ? (
            <p
              className="czw-auth-message"
              ref={messageRef}
              role={status === "success" ? "status" : "alert"}
              tabIndex={-1}
            >
              {message}
            </p>
          ) : null}

          {status === "success" ? (
            <a className="czw-button czw-button-primary" href="/admin">
              Continue to dashboard
            </a>
          ) : null}

          <a className="czw-auth-back" href="/admin/login">
            Back to admin login
          </a>
        </section>
      </main>
    </div>
  );
}
