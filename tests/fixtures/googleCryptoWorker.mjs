/* global Response */
import {
  encryptGoogleRefreshToken,
  decryptGoogleRefreshToken,
} from "../../server/googleCalendarSync.ts";

export default {
  async fetch(request) {
    const { legacy } = await request.json();
    const env = { TOKEN_ENCRYPTION_KEY: "fixture-original-key" };
    const expected = "fixture-refresh-value";
    let wrongKeyRejected = false;
    try {
      decryptGoogleRefreshToken(legacy, {
        TOKEN_ENCRYPTION_KEY: "wrong-fixture-key",
      });
    } catch (error) {
      wrongKeyRejected = error.code === "GOOGLE_CREDENTIAL_INVALID";
    }
    return Response.json({
      legacyCompatible: decryptGoogleRefreshToken(legacy, env) === expected,
      roundTrip:
        decryptGoogleRefreshToken(
          encryptGoogleRefreshToken(expected, env),
          env,
        ) === expected,
      wrongKeyRejected,
    });
  },
};
