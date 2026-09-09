export type WebPushConfig =
  | { enabled: false }
  | {
      enabled: true;
      publicKey: string;
      privateKey: string;
      subject: string;
    };

const base64UrlPattern = /^[A-Za-z0-9_-]+$/;

function clean(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function validSubject(value: string) {
  if (value.startsWith("mailto:")) {
    return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value);
  }
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function getWebPushConfig(
  env: NodeJS.ProcessEnv = process.env,
): WebPushConfig {
  const publicKey = clean(env.WEB_PUSH_VAPID_PUBLIC_KEY);
  const privateKey = clean(env.WEB_PUSH_VAPID_PRIVATE_KEY);
  const subject = clean(env.WEB_PUSH_VAPID_SUBJECT);
  const configured = [publicKey, privateKey, subject].filter(Boolean).length;

  if (configured === 0) return { enabled: false };
  if (configured !== 3) {
    throw new Error("WEB_PUSH_VAPID_CONFIG_INCOMPLETE");
  }
  if (
    !base64UrlPattern.test(publicKey!) ||
    publicKey!.length < 80 ||
    publicKey!.length > 120
  ) {
    throw new Error("WEB_PUSH_VAPID_PUBLIC_KEY_INVALID");
  }
  if (
    !base64UrlPattern.test(privateKey!) ||
    privateKey!.length < 40 ||
    privateKey!.length > 80
  ) {
    throw new Error("WEB_PUSH_VAPID_PRIVATE_KEY_INVALID");
  }
  if (!validSubject(subject!)) {
    throw new Error("WEB_PUSH_VAPID_SUBJECT_INVALID");
  }

  return {
    enabled: true,
    publicKey: publicKey!,
    privateKey: privateKey!,
    subject: subject!,
  };
}

export function publicWebPushConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = getWebPushConfig(env);
  return config.enabled
    ? { enabled: true as const, publicKey: config.publicKey }
    : { enabled: false as const };
}
