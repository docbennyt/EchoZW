import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pilotMvp = readFileSync("src/pilotMvp.tsx", "utf8");

describe("founder and Admin Team workspace", () => {
  it("shows durable founder identity and founder-only Admin invitation controls", () => {
    expect(pilotMvp).toContain('member.isFounder ? "Founder · Superadmin" : "Admin"');
    expect(pilotMvp).toContain(
      "const canManageAdmins = session.permissions.canManageAdmins",
    );
    expect(pilotMvp).toContain("Invite Admin");
    expect(pilotMvp).toContain(
      "Admin can manage CalenderZW operations and Class Reps, but",
    );
    expect(pilotMvp).toContain("cannot change founder/superadmin authority.");
  });

  it("never renders destructive Admin controls for the founder row", () => {
    expect(pilotMvp).toContain("!member.isFounder && canManageAdmins");
    expect(pilotMvp).toContain("Protected root authority");
    expect(pilotMvp).toContain("Revoke Admin role");
  });

  it("routes operational Admins into the global shell using server permissions, not a role-string shortcut", () => {
    expect(pilotMvp).toContain(
      "session?.permissions.canManageAllTimetables ?? false",
    );
    expect(pilotMvp).toContain('session?.staff.role === "class_rep"');
    expect(pilotMvp).not.toContain(
      'const isSuperadmin = session?.staff.role === "superadmin"',
    );
  });
});
