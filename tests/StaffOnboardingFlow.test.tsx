import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaffOnboardingFlow } from "../src/StaffOnboardingFlow";
import type { ResolvedStaffOnboarding } from "../src/domain/staffOnboarding";
import type {
  AppInstallCapability,
  AppInstallResult,
} from "../src/pwa/installCapability";

const track = vi.fn();
vi.mock("../src/analytics", () => ({
  track: (...args: unknown[]) => track(...args),
}));

const admin: ResolvedStaffOnboarding = {
  role: "admin",
  roleLabel: "Admin",
  destination: "/admin",
  summary:
    "Your operational Admin access is ready. Founder-only authority remains protected.",
  assignment: null,
};

function adapter(
  capability: AppInstallCapability,
  result: AppInstallResult = "accepted",
) {
  return {
    getCapability: vi.fn(() => capability),
    requestInstall: vi.fn(async () => result),
    subscribe: vi.fn(() => () => undefined),
  };
}

beforeEach(() => track.mockReset());

describe("StaffOnboardingFlow", () => {
  it("opens the Chromium install prompt only after the explicit Install action", async () => {
    const installAdapter = adapter("promptable", "accepted");
    const navigate = vi.fn();
    render(
      <StaffOnboardingFlow
        resolved={admin}
        installAdapter={installAdapter}
        navigate={navigate}
      />,
    );

    expect(installAdapter.requestInstall).not.toHaveBeenCalled();
    expect(screen.getByText("Admin")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Install CalenderZW" }));

    await waitFor(() =>
      expect(installAdapter.requestInstall).toHaveBeenCalledTimes(1),
    );
    expect(navigate).toHaveBeenCalledWith("/admin");
    expect(track).toHaveBeenCalledWith("staff_install_result", {
      mode: "admin",
      status: "accepted",
    });
  });

  it("does not nag again in the same flow after an install prompt is dismissed", async () => {
    const installAdapter = adapter("promptable", "dismissed");
    render(
      <StaffOnboardingFlow
        resolved={admin}
        installAdapter={installAdapter}
        navigate={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Install CalenderZW" }));
    expect(
      await screen.findByText(/Installation was dismissed/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install CalenderZW" }),
    ).toBeNull();
    expect(installAdapter.requestInstall).toHaveBeenCalledTimes(1);
  });

  it("shows truthful iOS Add to Home Screen instructions without a fake install prompt", () => {
    const installAdapter = adapter("ios_manual", "manual_required");
    render(
      <StaffOnboardingFlow
        resolved={admin}
        installAdapter={installAdapter}
        navigate={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", {
        name: "Add CalenderZW to your Home Screen",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Tap Share/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install CalenderZW" }),
    ).toBeNull();
    expect(installAdapter.requestInstall).not.toHaveBeenCalled();
  });

  it("routes already-installed staff directly to their server-authorized workspace", async () => {
    const installAdapter = adapter("installed", "already_installed");
    const navigate = vi.fn();
    render(
      <StaffOnboardingFlow
        resolved={admin}
        installAdapter={installAdapter}
        navigate={navigate}
      />,
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/admin"));
    expect(installAdapter.requestInstall).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith("staff_install_detected", {
      mode: "admin",
      status: "installed",
    });
  });

  it("lets unsupported environments continue in browser without changing access", () => {
    const installAdapter = adapter("unsupported", "unavailable");
    const navigate = vi.fn();
    render(
      <StaffOnboardingFlow
        resolved={admin}
        installAdapter={installAdapter}
        navigate={navigate}
      />,
    );

    expect(
      screen.getByText(/cannot offer app installation/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Continue to workspace" }),
    );
    expect(navigate).toHaveBeenCalledWith("/admin");
  });
});
