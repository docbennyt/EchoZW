// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { restoreAuthSessionFromRedirect } from "../src/authRecovery";

vi.mock("@supabase/ssr", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@supabase/ssr")>();
  return {
    ...sdk,
    // Reset the SDK's independent singleton between tests, preserving app auth options.
    createBrowserClient: (
      ...args: Parameters<typeof sdk.createBrowserClient>
    ) =>
      sdk.createBrowserClient(args[0], args[1], {
        ...args[2],
        isSingleton: false,
      }),
  };
});

let fixtureNumber = 0;
let projectUrl: string;
let storageKey: string;
const fixtureCode = "synthetic-single-use-pkce-code";
const verifier = "synthetic-pkce-verifier-for-isolated-sdk-test-only";
const user = {
  id: "10000000-0000-4000-8000-000000000001",
  aud: "authenticated",
  role: "authenticated",
  email: "callback@example.test",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const encode = (value: unknown) =>
  btoa(JSON.stringify(value))
    .replaceAll("=", "")
    .replaceAll("+", "-")
    .replaceAll("/", "_");
const accessToken = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: 4102444800 })}.synthetic-signature`;
let client: SupabaseClient | undefined;
let tokenRequests: Array<{ auth_code: string; code_verifier: string }>;
let rejectExchange: boolean;

function seedVerifier() {
  document.cookie = `${storageKey}-code-verifier=${encodeURIComponent(JSON.stringify(`${verifier}/recovery`))}; Path=/`;
}

async function initialize(path: string, exposeCallbackToSdk = true) {
  const callbackUrl = new URL(
    `${path}?code=${fixtureCode}&type=recovery`,
    window.location.origin,
  );
  window.history.replaceState({}, "", exposeCallbackToSdk ? callbackUrl : path);
  seedVerifier();
  const { createClient } = await import("../src/utils/supabase/client");
  client = createClient();
  // Allow the real SDK initialization to finish, as an earlier app consumer can.
  await client.auth.initialize();
  return { auth: client.auth, callbackUrl };
}

beforeEach(() => {
  vi.resetModules();
  fixtureNumber += 1;
  projectUrl = `https://callback-fixture-${fixtureNumber}.supabase.co`;
  storageKey = `sb-callback-fixture-${fixtureNumber}-auth-token`;
  tokenRequests = [];
  rejectExchange = false;
  window.localStorage.clear();
  window.sessionStorage.clear();
  for (const cookie of document.cookie.split(";")) {
    document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; Path=/`;
  }
  window.__CALENDERZW_RUNTIME_CONFIG__ = {
    supabaseUrl: projectUrl,
    supabasePublishableKey: "sb_publishable_synthetic_callback_fixture",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin !== projectUrl)
        throw new Error("Unexpected external request in callback fixture");
      if (
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "password" &&
        init?.method === "POST"
      ) {
        expect(JSON.parse(String(init.body))).toMatchObject({
          email: user.email,
          password: "synthetic-login-password",
        });
        return new Response(
          JSON.stringify({
            access_token: accessToken,
            refresh_token: "synthetic-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            user,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "pkce" &&
        init?.method === "POST"
      ) {
        const body = JSON.parse(String(init.body));
        tokenRequests.push(body);
        const denied = rejectExchange || tokenRequests.length > 1;
        return new Response(
          JSON.stringify(
            denied
              ? {
                  error: "invalid_grant",
                  error_code: "flow_state_not_found",
                  msg: "Synthetic code rejected",
                }
              : {
                  access_token: accessToken,
                  refresh_token: "synthetic-refresh-token",
                  token_type: "bearer",
                  expires_in: 3600,
                  user,
                },
          ),
          {
            status: denied ? 400 : 200,
            headers: {
              "content-type": "application/json",
              "x-supabase-api-version": "2024-01-01",
            },
          },
        );
      }
      throw new Error("Unexpected Auth endpoint in callback fixture");
    }),
  );
});

afterEach(async () => {
  await client?.auth.dispose();
  client = undefined;
  delete window.__CALENDERZW_RUNTIME_CONFIG__;
  window.history.replaceState({}, "", "/");
  for (const cookie of document.cookie.split(";")) {
    document.cookie = `${cookie.split("=")[0].trim()}=; Max-Age=0; Path=/`;
  }
  vi.unstubAllGlobals();
});

describe("real SSR/Auth SDK callback ownership", () => {
  it("retains explicit password login and cookie-backed session recovery on an ordinary page", async () => {
    const { auth } = await initialize("/admin/login", false);
    expect((await auth.getSession()).data.session).toBeNull();
    expect(fetch).not.toHaveBeenCalled();

    const signedIn = await auth.signInWithPassword({
      email: user.email,
      password: "synthetic-login-password",
    });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.session?.user.id).toBe(user.id);
    expect((await auth.getSession()).data.session?.access_token).toBe(
      accessToken,
    );
    expect(tokenRequests).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(document.cookie).toContain(`${storageKey}=`);

    await auth.dispose();
    vi.resetModules();
    const { createClient } = await import("../src/utils/supabase/client");
    client = createClient();
    await client.auth.initialize();
    expect((await client.auth.getSession()).data.session?.user.id).toBe(
      user.id,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["/account/update-password", "/auth/confirm", "/auth/callback"])(
    "does not auto-exchange on manually owned %s and exchanges exactly once through the app",
    async (path) => {
      const { auth, callbackUrl } = await initialize(path);
      expect(tokenRequests).toEqual([]);
      expect((await auth.getSession()).data.session).toBeNull();
      expect(window.location.search).toContain(`code=${fixtureCode}`);

      const result = await restoreAuthSessionFromRedirect(auth, callbackUrl);
      expect(result).toEqual({
        ok: true,
        intent: "recovery",
        sessionEstablished: true,
      });
      expect(tokenRequests).toEqual([
        { auth_code: fixtureCode, code_verifier: verifier },
      ]);
      expect((await auth.getSession()).data.session?.user.id).toBe(user.id);
      expect(window.location.search).toBe("");
    },
  );

  it("does not show an invalid recovery after an SDK initialization that preceded the page", async () => {
    const { auth, callbackUrl } = await initialize("/account/update-password");
    const result = await restoreAuthSessionFromRedirect(auth, callbackUrl);
    expect(result).toEqual({
      ok: true,
      intent: "recovery",
      sessionEstablished: true,
    });
    expect(tokenRequests).toEqual([
      { auth_code: fixtureCode, code_verifier: verifier },
    ]);
  });

  it.each([false, true])(
    "preserves sb_flow_id through sanitization and exchanges only its verifier (conflicting legacy cookie: %s)",
    async (withLegacyCookie) => {
      const { auth, callbackUrl } = await initialize(
        "/account/update-password",
      );
      expect(tokenRequests).toEqual([]);
      const flowId = "synthetic_target_flow_1234";
      const otherFlowId = "synthetic_other_flow_5678";
      const flowVerifier = "synthetic-target-flow-verifier";
      const otherVerifier = "synthetic-other-flow-verifier";
      const slotKey = `${storageKey}-flow-${flowId}-code-verifier`;
      const otherSlotKey = `${storageKey}-flow-${otherFlowId}-code-verifier`;
      document.cookie = `${storageKey}-code-verifier=; Max-Age=0; Path=/`;
      if (withLegacyCookie) seedVerifier();
      document.cookie = `${slotKey}=${encodeURIComponent(JSON.stringify(`${flowVerifier}/recovery`))}; Path=/`;
      document.cookie = `${otherSlotKey}=${encodeURIComponent(JSON.stringify(`${otherVerifier}/recovery`))}; Path=/`;
      callbackUrl.searchParams.set("sb_flow_id", flowId);
      window.history.replaceState({}, "", callbackUrl);
      const exchange = vi.spyOn(auth, "exchangeCodeForSession");
      const sanitize = vi.fn(() => {
        window.history.replaceState({}, "", callbackUrl.pathname);
      });

      const result = await restoreAuthSessionFromRedirect(auth, callbackUrl, {
        sanitize,
      });

      expect(result).toEqual({
        ok: true,
        intent: "recovery",
        sessionEstablished: true,
      });
      expect(exchange).toHaveBeenCalledExactlyOnceWith(fixtureCode, { flowId });
      expect(sanitize).toHaveBeenCalledOnce();
      expect(sanitize.mock.invocationCallOrder[0]).toBeLessThan(
        exchange.mock.invocationCallOrder[0],
      );
      expect(window.location.search).toBe("");
      expect(window.location.hash).toBe("");
      expect(tokenRequests).toEqual([
        { auth_code: fixtureCode, code_verifier: flowVerifier },
      ]);
      const cookieNames = document.cookie
        .split(";")
        .map((cookie) => cookie.trim().split("=")[0]);
      expect(cookieNames).not.toContain(slotKey);
      expect(cookieNames).toContain(otherSlotKey);
      expect(cookieNames.includes(`${storageKey}-code-verifier`)).toBe(
        withLegacyCookie,
      );
    },
  );

  it("does not mask a rejected fresh code with a previously established session", async () => {
    const { auth, callbackUrl } = await initialize(
      "/account/update-password",
      false,
    );
    const established = await restoreAuthSessionFromRedirect(auth, callbackUrl);
    expect(established.ok).toBe(true);
    expect((await auth.getSession()).data.session?.user.id).toBe(user.id);
    seedVerifier();
    rejectExchange = true;
    const rejected = await restoreAuthSessionFromRedirect(
      auth,
      new URL(
        `${window.location.origin}/account/update-password?code=synthetic-invalid-code&type=recovery`,
      ),
    );
    expect(rejected).toEqual({
      ok: false,
      intent: "recovery",
      code: "AUTH_RECOVERY_CODE_EXCHANGE_FAILED",
    });
    expect(tokenRequests).toHaveLength(2);
    expect(tokenRequests[1].auth_code).toBe("synthetic-invalid-code");
    expect((await auth.getSession()).data.session?.user.id).toBe(user.id);
  });
});
