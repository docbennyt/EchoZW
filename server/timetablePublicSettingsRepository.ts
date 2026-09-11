import { createSupabaseAdminClient } from "./supabase/adminClient.js";
import { PilotApiError } from "./pilotRepository.js";

export type TimetablePublicDisplaySettings = {
  showVisualPreview: boolean;
  showChangeAlerts: boolean;
};

type SettingsRow = {
  timetable_id?: string;
  show_visual_preview?: boolean;
  show_change_alerts?: boolean;
  updated_at?: string;
  updated_by_staff_user_id?: string | null;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

export const DEFAULT_TIMETABLE_PUBLIC_DISPLAY_SETTINGS: TimetablePublicDisplaySettings =
  {
    showVisualPreview: false,
    showChangeAlerts: false,
  };

function mapSettings(row: SettingsRow | null): TimetablePublicDisplaySettings {
  if (!row) return { ...DEFAULT_TIMETABLE_PUBLIC_DISPLAY_SETTINGS };
  return {
    showVisualPreview: row.show_visual_preview === true,
    showChangeAlerts: row.show_change_alerts === true,
  };
}

function isSchemaCompatibilityError(error: SupabaseErrorLike | null) {
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "42703" ||
      error.code === "PGRST204" ||
      error.code === "PGRST205"),
  );
}

/**
 * Public reads deliberately fail closed. During a schema-first or web-first deploy,
 * a missing table/row must never break the trusted timetable route or accidentally
 * expose an optional public surface.
 */
export async function getTimetablePublicDisplaySettings(
  timetableId: string,
): Promise<TimetablePublicDisplaySettings> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client
    .from("timetable_public_settings")
    .select("show_visual_preview, show_change_alerts")
    .eq("timetable_id", timetableId)
    .maybeSingle();

  if (error) {
    return { ...DEFAULT_TIMETABLE_PUBLIC_DISPLAY_SETTINGS };
  }

  return mapSettings(data as SettingsRow | null);
}

export async function updateTimetablePublicDisplaySettings(input: {
  timetableId: string;
  staffUserId: string;
  showVisualPreview: boolean;
  showChangeAlerts: boolean;
}): Promise<TimetablePublicDisplaySettings> {
  const client = createSupabaseAdminClient();
  const { data, error } = await client
    .from("timetable_public_settings")
    .upsert(
      {
        timetable_id: input.timetableId,
        show_visual_preview: input.showVisualPreview,
        show_change_alerts: input.showChangeAlerts,
        updated_at: new Date().toISOString(),
        updated_by_staff_user_id: input.staffUserId,
      },
      { onConflict: "timetable_id" },
    )
    .select("show_visual_preview, show_change_alerts")
    .single();

  if (error) {
    const databaseError = error as SupabaseErrorLike;
    if (isSchemaCompatibilityError(databaseError)) {
      throw new PilotApiError(
        "PUBLIC_SETTINGS_SCHEMA_UNAVAILABLE",
        "Public timetable settings are not available until the database migration is applied.",
        503,
      );
    }
    if (databaseError.code === "23503") {
      throw new PilotApiError("NOT_FOUND", "Timetable not found.", 404);
    }
    throw new PilotApiError(
      "DATABASE_UNAVAILABLE",
      "Could not update public timetable settings.",
      503,
      { code: databaseError.code ?? null },
    );
  }

  return mapSettings(data as SettingsRow);
}
