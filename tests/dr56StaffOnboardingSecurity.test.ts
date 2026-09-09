import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("DR-56 staff onboarding security boundaries", () => {
  it("keeps staff enrollment behind authenticated Admin routes", () => {
    const adminApi = source("server/adminApi.ts");
    const staffApi = source("server/staffAdminApi.ts");

    expect(adminApi).toContain(
      'requestUrl.pathname.startsWith("/api/admin/staff")',
    );
    expect(adminApi).toContain("requireStaffManager(req, deps)");
    expect(staffApi).toContain('"/api/admin/staff/invite"');
    expect(staffApi).toContain('"/api/admin/staff/invite-admin"');
    expect(staffApi).not.toContain("/api/public/staff");
  });

  it("resolves role from the bearer-authenticated server session, never invite query params", () => {
    const authSetup = source("src/AuthSetupPage.tsx");
    const adminSession = source("src/api/adminSession.ts");
    const onboarding = source("src/domain/staffOnboarding.ts");

    expect(authSetup).toContain("fetchAdminSession(accessToken)");
    expect(adminSession).toContain("Authorization: `Bearer ${accessToken}`");
    expect(onboarding).toContain("const { staff, assignments } = session");
    expect(onboarding).toContain('staff.role === "superadmin"');
    expect(onboarding).toContain('staff.role === "class_rep"');
    expect(authSetup).not.toMatch(/searchParams\.get\(["']role["']\)/);
    expect(authSetup).not.toMatch(/localStorage.*role|role.*localStorage/);
  });

  it("keeps direct /admin access independently server-authorized", () => {
    const adminWorkspace = source("src/pilotMvp.tsx");
    expect(adminWorkspace).toContain("fetchAdminSession(token)");
    expect(adminWorkspace).toContain("supabase.auth.getSession()");
  });

  it("reuses DR-46 install capability instead of duplicating service-worker logic", () => {
    const flow = source("src/StaffOnboardingFlow.tsx");
    expect(flow).toContain('from "./pwa/installCapability"');
    expect(flow).not.toContain("beforeinstallprompt");
    expect(flow).not.toContain("serviceWorker.register");
  });

  it("does not place auth, invite, email or push capability data into onboarding analytics", () => {
    const flow = source("src/StaffOnboardingFlow.tsx");
    for (const forbidden of [
      "accessToken",
      "refreshToken",
      "authorizationCode",
      "inviteToken",
      "endpoint",
      "p256dh",
      "auth_secret",
    ]) {
      expect(flow).not.toContain(forbidden);
    }
  });
});
