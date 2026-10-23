import { createCipheriv, createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ getGoogleCredential: vi.fn() }));
vi.mock("../server/googleCalendarRepository", async (original) => ({
  ...(await original<typeof import("../server/googleCalendarRepository")>()),
  ...repository,
}));
import { checkGoogleCredentialCompatibility } from "../server/googleCalendarSync";

const env = { TOKEN_ENCRYPTION_KEY: "synthetic-original-key" };
// Independently construct the Railway v1 wire format, not a round-trip through
// the production encryptor under test.
function legacyBundle(plaintext = "synthetic-refresh-token") {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(env.TOKEN_ENCRYPTION_KEY).digest(),
    iv,
  );
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

describe("read-only original-key compatibility diagnostic", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("decrypts independently constructed legacy bytes, returns no secret, and makes no network requests", async () => {
    repository.getGoogleCredential.mockResolvedValue({
      encrypted_refresh_token: legacyBundle(),
    });
    const network = vi.spyOn(globalThis, "fetch");
    const result = await checkGoogleCredentialCompatibility(
      "subscription",
      env,
    );
    expect(result).toEqual({
      readOnly: true,
      credentialPresent: true,
      decryptionCompatible: true,
      formatVersion: "v1",
      providerAuthorizationVerified: false,
    });
    expect(JSON.stringify(result)).not.toContain("synthetic");
    expect(repository.getGoogleCredential).toHaveBeenCalledWith(
      "subscription",
      env,
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("rejects the wrong key without disclosing ciphertext or plaintext", async () => {
    repository.getGoogleCredential.mockResolvedValue({
      encrypted_refresh_token: legacyBundle(),
    });
    await expect(
      checkGoogleCredentialCompatibility("subscription", {
        TOKEN_ENCRYPTION_KEY: "wrong",
      }),
    ).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_INVALID" });
  });
  it("distinguishes a missing original key from invalid credentials", async () => {
    repository.getGoogleCredential.mockResolvedValue({
      encrypted_refresh_token: legacyBundle(),
    });
    await expect(
      checkGoogleCredentialCompatibility("subscription", {}),
    ).rejects.toMatchObject({ code: "GOOGLE_TOKEN_ENCRYPTION_NOT_CONFIGURED" });
  });
  it.each([
    null,
    { encrypted_refresh_token: "v2.invalid" },
    { encrypted_refresh_token: legacyBundle(" ") },
  ])("rejects absent, unsupported or empty credentials", async (credential) => {
    repository.getGoogleCredential.mockResolvedValue(credential);
    await expect(
      checkGoogleCredentialCompatibility("subscription", env),
    ).rejects.toMatchObject({ code: "GOOGLE_CREDENTIAL_INVALID" });
  });
});
