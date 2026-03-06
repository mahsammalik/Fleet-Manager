import { query } from "../../db/pool";

export type ActivityType =
  | "profile_update"
  | "status_change"
  | "document_upload"
  | "document_verify"
  | "document_delete"
  | "driver_delete"
  | "notes_update";

export async function logDriverActivity(
  driverId: string,
  activityType: ActivityType,
  options: {
    description?: string;
    performedBy?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const { description, performedBy, oldValues, newValues } = options;
  await query(
    `
    INSERT INTO driver_activities (driver_id, activity_type, activity_description, performed_by, old_values, new_values)
    VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [
      driverId,
      activityType,
      description ?? null,
      performedBy ?? null,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
    ],
  );
}
