type Bindings = Record<string, unknown>;
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

/** Protected operator configuration only. Never read scope from HTTP input. */
export function googleProductionRecoveryScope(env: Bindings) {
  if (
    env.APP_ENV !== "cloudflare-production" ||
    env.ENABLE_GOOGLE_DELIVERY !== "false"
  )
    return null;
  const raw = env.GOOGLE_PRODUCTION_RECOVERY;
  if (typeof raw !== "string" || raw.length > 16384) return null;
  try {
    const s = JSON.parse(raw);
    const keys = [
      "candidateSha",
      "ownerId",
      "timetableId",
      "subscriptionId",
      "expiresAt",
      "revision",
      "connectionGeneration",
      "maxCreates",
      "maxUpdates",
      "maxDeletes",
      "deliveryRevision",
      "deliveryGeneration",
      "manifestHash",
      "createKeys",
      "updateKeys",
    ];
    const remaining = Date.parse(s.expiresAt) - Date.now();
    if (
      !s ||
      Array.isArray(s) ||
      Object.keys(s).length !== keys.length ||
      Object.keys(s).some((key) => !keys.includes(key)) ||
      !/^[a-f0-9]{40}$/.test(s.candidateSha) ||
      s.candidateSha !== env.SOURCE_SHA ||
      !uuid(s.ownerId) ||
      !uuid(s.timetableId) ||
      !uuid(s.subscriptionId) ||
      typeof s.expiresAt !== "string" ||
      !Number.isFinite(remaining) ||
      remaining <= 0 ||
      remaining > 86400000 ||
      !Number.isSafeInteger(s.revision) ||
      s.revision < 1 ||
      s.revision > 2147483647 ||
      !Number.isSafeInteger(s.connectionGeneration) ||
      s.connectionGeneration < 0 ||
      !Number.isSafeInteger(s.maxCreates) ||
      s.maxCreates < 0 ||
      s.maxCreates > 16 ||
      !Number.isSafeInteger(s.maxUpdates) ||
      s.maxUpdates < 0 ||
      s.maxUpdates > 64 ||
      !Array.isArray(s.createKeys) ||
      !Array.isArray(s.updateKeys) ||
      s.createKeys.length > s.maxCreates ||
      s.updateKeys.length > s.maxUpdates ||
      [...s.createKeys, ...s.updateKeys].some(
        (key) => typeof key !== "string" || !/^[a-f0-9]{64}$/.test(key),
      ) ||
      new Set([...s.createKeys, ...s.updateKeys]).size !==
        s.createKeys.length + s.updateKeys.length ||
      !Number.isSafeInteger(s.deliveryRevision) ||
      s.deliveryRevision < 1 ||
      !Number.isSafeInteger(s.deliveryGeneration) ||
      s.deliveryGeneration < 1 ||
      s.maxDeletes !== 0 ||
      typeof s.manifestHash !== "string" ||
      !/^[a-f0-9]{64}$/.test(s.manifestHash)
    )
      return null;
    return {
      deliveryRevision: s.deliveryRevision as number,
      deliveryGeneration: s.deliveryGeneration as number,
      expires: Date.parse(s.expiresAt),
      owner: s.ownerId as string,
      timetable: s.timetableId as string,
      subscription: s.subscriptionId as string,
      revision: s.revision as number,
      connectionGeneration: s.connectionGeneration as number,
      maxCreates: s.maxCreates as number,
      maxUpdates: s.maxUpdates as number,
      maxDeletes: 0,
      manifestHash: s.manifestHash as string,
      createKeys: s.createKeys as string[],
      updateKeys: s.updateKeys as string[],
    };
  } catch {
    return null;
  }
}
