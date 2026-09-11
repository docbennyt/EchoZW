import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  readResult: { data: null as unknown, error: null as unknown },
  writeResult: { data: null as unknown, error: null as unknown },
  upsert: vi.fn(),
}));

vi.mock("../server/supabase/adminClient", () => ({
  createSupabaseAdminClient: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => state.readResult),
        })),
      })),
      upsert: state.upsert.mockImplementation(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => state.writeResult),
        })),
      })),
    })),
  }),
}));

import {
  getTimetablePublicDisplaySettings,
  updateTimetablePublicDisplaySettings,
} from "../server/timetablePublicSettingsRepository";

describe("timetable public settings repository", () => {
  beforeEach(() => {
    state.upsert.mockClear();
    state.readResult = { data: null, error: null };
    state.writeResult = {
      data: { show_visual_preview: false, show_change_alerts: false },
      error: null,
    };
  });

  it("fails closed when a timetable has no settings row", async () => {
    await expect(getTimetablePublicDisplaySettings("tt-1")).resolves.toEqual({
      showVisualPreview: false,
      showChangeAlerts: false,
    });
  });

  it("fails closed when the settings table is temporarily unavailable", async () => {
    state.readResult = {
      data: null,
      error: { code: "42P01", message: "relation does not exist" },
    };

    await expect(getTimetablePublicDisplaySettings("tt-1")).resolves.toEqual({
      showVisualPreview: false,
      showChangeAlerts: false,
    });
  });

  it("maps only the two public booleans", async () => {
    state.readResult = {
      data: {
        show_visual_preview: true,
        show_change_alerts: false,
        updated_by_staff_user_id: "staff-founder",
      },
      error: null,
    };

    await expect(getTimetablePublicDisplaySettings("tt-1")).resolves.toEqual({
      showVisualPreview: true,
      showChangeAlerts: false,
    });
  });

  it("retains the founder staff actor on mutation", async () => {
    state.writeResult = {
      data: { show_visual_preview: true, show_change_alerts: true },
      error: null,
    };

    await expect(
      updateTimetablePublicDisplaySettings({
        timetableId: "tt-1",
        staffUserId: "staff-founder",
        showVisualPreview: true,
        showChangeAlerts: true,
      }),
    ).resolves.toEqual({
      showVisualPreview: true,
      showChangeAlerts: true,
    });

    expect(state.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        timetable_id: "tt-1",
        updated_by_staff_user_id: "staff-founder",
        show_visual_preview: true,
        show_change_alerts: true,
      }),
      { onConflict: "timetable_id" },
    );
  });

  it("does not pretend a mutation succeeded before the schema is available", async () => {
    state.writeResult = {
      data: null,
      error: { code: "PGRST205", message: "table missing from schema cache" },
    };

    await expect(
      updateTimetablePublicDisplaySettings({
        timetableId: "tt-1",
        staffUserId: "staff-founder",
        showVisualPreview: true,
        showChangeAlerts: false,
      }),
    ).rejects.toMatchObject({
      code: "PUBLIC_SETTINGS_SCHEMA_UNAVAILABLE",
      status: 503,
    });
  });
});
