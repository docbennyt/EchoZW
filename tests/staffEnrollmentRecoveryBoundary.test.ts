import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("DR-149 staff enrollment recovery boundary", () => {
  it("never uses password recovery to provision or resend staff access", () => {
    const staffRepository = source("server/staffRepository.ts");

    expect(staffRepository).not.toContain("resetPasswordForEmail");
    expect(staffRepository).toContain("inviteUserByEmail");
    expect(staffRepository).toContain("access_granted_existing_user");
    expect(staffRepository).toContain("invite_resent_pending_user");
  });

  it("uses PUBLIC_APP_URL as the canonical server-side public origin", () => {
    const staffRepository = source("server/staffRepository.ts");
    const publicAppIndex = staffRepository.indexOf("PUBLIC_APP_URL");
    const legacySiteIndex = staffRepository.indexOf("PUBLIC_SITE_URL");

    expect(publicAppIndex).toBeGreaterThanOrEqual(0);
    expect(legacySiteIndex).toBeGreaterThan(publicAppIndex);
    expect(staffRepository).toContain("https://calender.aido.co.zw");
  });

  it("keeps browser invite and recovery intents distinct", () => {
    const authRecovery = source("src/authRecovery.ts");
    const authSetup = source("src/AuthSetupPage.tsx");

    expect(authRecovery).toContain('"invite" | "recovery" | "unknown"');
    expect(authRecovery).toContain('explicitType !== "invite"');
    expect(authRecovery).toContain('explicitType !== "recovery"');
    expect(authSetup).toContain('if (intent === "invite")');
    expect(authSetup).toContain('eyebrow: "Account recovery"');
  });
});
