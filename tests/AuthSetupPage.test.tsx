import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSetupPage } from "../src/AuthSetupPage";
import type { AdminSessionResponse } from "../src/api/adminSession";

const createSupabaseClient = vi.fn();
const fetchAdminSession = vi.fn();
const track = vi.fn();

vi.mock("../src/utils/supabase/client", () => ({
  createClient: () => createSupabaseClient(),
}));

vi.mock("../src/api/adminSession", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/api/adminSession")>();
  return {
    ...actual,
    fetchAdminSession: (...args: unknown[]) => fetchAdminSession(...args),
  };
});

vi.mock("../src/analytics", () => ({
  track: (...args: unknown[]) => track(...args),
}));

function workingAuth() {
  return {
    setSession: vi.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: {}, error: null })),
    verifyOtp: vi.fn(async () => ({ data: {}, error: null })),
    getSession: vi.fn(async () => ({
      data: { session: { access_token: "session-only" } },
      error: null,
    })),
    updateUser: vi.fn(async () => ({ data: {}, error: null })),
  };
}

function classRepSession(): AdminSessionResponse {
  return {
    authenticated: true,
    admin: true,
    user: { id: "user-1", email: "rep@example.com" },
    staff: {
      id: "staff-1",
      role: "class_rep",
      isFounder: false,
      displayName: "Class Rep",
      email: "rep@example.com",
    },
    permissions: {
      canManageStaff: false,
      canManageAdmins: false,
      canManageClassReps: false,
      canManageInstitutions: false,
      canManageProgrammes: false,
      canManageClassGroups: false,
      canManageAcademicPeriods: false,
      canManageAllTimetables: false,
      canEditAllTimetables: false,
      canPublishAllTimetables: false,
      canManageSources: false,
      canViewOperationalAnalytics: false,
      canManageFounderAuthority: false,
      canEditAssignedTimetables: true,
      canPublishAssignedTimetables: true,
    },
    assignments: [
      {
        id: "assignment-1",
        timetableId: "timetable-1",
        publicSlug: "hit-ics-1-1-august-semester-2026",
        institutionName: "Harare Institute of Technology",
        programmeName: "Computer Science",
        classGroupLabel: "CS.1",
        academicPeriodName: "August Semester 2026",
      },
    ],
  };
}

beforeEach(() => {
  createSupabaseClient.mockReset();
  fetchAdminSession.mockReset();
  track.mockReset();
  window.history.replaceState({}, "", "/");
});

describe("AuthSetupPage", () => {
  it("turns an invite into signup, sanitizes secrets, then resolves the server-authorized role", async () => {
    const auth = workingAuth();
    createSupabaseClient.mockReturnValue({ auth });
    fetchAdminSession.mockResolvedValue(classRepSession());
    window.history.replaceState(
      {},
      "",
      "/account/update-password#access_token=test-access&refresh_token=test-refresh&type=invite",
    );

    render(<AuthSetupPage />);

    expect(
      await screen.findByRole("heading", { name: "Complete signup." }),
    ).toBeInTheDocument();
    expect(screen.getByText("CalenderZW team signup")).toBeInTheDocument();
    expect(auth.setSession).toHaveBeenCalledWith({
      access_token: "test-access",
      refresh_token: "test-refresh",
    });
    expect(window.location.pathname).toBe("/account/update-password");
    expect(window.location.search).toBe("");
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("test-access");
    expect(window.location.href).not.toContain("test-refresh");

    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create password/i }));

    await waitFor(() =>
      expect(auth.updateUser).toHaveBeenCalledWith({
        password: "new-secure-password",
      }),
    );
    expect(fetchAdminSession).toHaveBeenCalledWith("session-only");
    expect(await screen.findByText("Class Rep")).toBeInTheDocument();
    expect(
      screen.getByText(/CS\.1 · August Semester 2026/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Continue to dashboard/i }),
    ).toBeNull();
  });

  it("fails closed after successful Auth when active staff authorization cannot be confirmed", async () => {
    const auth = workingAuth();
    createSupabaseClient.mockReturnValue({ auth });
    fetchAdminSession.mockRejectedValue(
      Object.assign(new Error("forbidden"), { name: "FORBIDDEN" }),
    );
    window.history.replaceState(
      {},
      "",
      "/account/update-password#access_token=test-access&refresh_token=test-refresh&type=invite",
    );

    render(<AuthSetupPage />);
    await screen.findByRole("heading", { name: "Complete signup." });
    fireEvent.change(screen.getByLabelText(/^New password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.change(screen.getByLabelText(/^Confirm new password$/i), {
      target: { value: "new-secure-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create password/i }));

    expect(
      await screen.findByText(
        /active CalenderZW staff access could not be confirmed/i,
      ),
    ).toHaveAttribute("role", "alert");
    expect(screen.queryByText("Install CalenderZW")).toBeNull();
  });

  it("explicitly exchanges a PKCE recovery code before showing password recovery", async () => {
    const auth = workingAuth();
    createSupabaseClient.mockReturnValue({ auth });
    window.history.replaceState(
      {},
      "",
      "/account/update-password?code=test-recovery-code",
    );

    render(<AuthSetupPage />);

    expect(
      await screen.findByRole("heading", { name: "Choose a new password." }),
    ).toBeInTheDocument();
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(
      "test-recovery-code",
    );
    expect(window.location.search).toBe("");
    expect(window.location.href).not.toContain("test-recovery-code");
    expect(fetchAdminSession).not.toHaveBeenCalled();
  });

  it("fails closed and gives invitation-specific recovery copy for malformed invite callbacks", async () => {
    const auth = workingAuth();
    createSupabaseClient.mockReturnValue({ auth });
    window.history.replaceState(
      {},
      "",
      "/account/update-password#access_token=test-access&type=invite",
    );

    render(<AuthSetupPage />);

    expect(
      await screen.findByText(
        "We couldn't verify this CalenderZW invitation. Ask the administrator to resend it.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
    expect(window.location.hash).toBe("");

    expect(track).toHaveBeenCalledWith("auth_client_error", {
      reason: "AUTH_INVITE_CALLBACK_INVALID",
      path: "/account/update-password",
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain("test-access");
  });

  it("never renders password fields when the Supabase browser client cannot initialize", async () => {
    createSupabaseClient.mockImplementation(() => {
      throw Object.assign(new Error("runtime config unavailable"), {
        code: "AUTH_CLIENT_CONFIG_MISSING",
      });
    });
    window.history.replaceState({}, "", "/account/update-password");

    render(<AuthSetupPage />);

    expect(
      await screen.findByText(
        "Account setup is temporarily unavailable. Please try again.",
      ),
    ).toHaveAttribute("role", "alert");
    expect(screen.queryByLabelText(/^New password$/i)).toBeNull();
    expect(screen.queryByLabelText(/^Confirm new password$/i)).toBeNull();
    expect(track).toHaveBeenCalledWith("auth_client_error", {
      reason: "AUTH_CLIENT_CONFIG_MISSING",
      path: "/account/update-password",
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain(
      "runtime config unavailable",
    );
  });
});
