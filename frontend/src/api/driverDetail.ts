import { api } from "../lib/api";
import type { Driver } from "./drivers";
import { getDriverById, deleteDriver } from "./drivers";

export interface DriverActivity {
  id: string;
  driver_id: string;
  activity_type: string;
  activity_description: string | null;
  performed_by: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
}

export function getDriverDetail(id: string) {
  return getDriverById(id);
}

export type { Driver };

export function updateDriverNotes(id: string, notes: string | null) {
  return api.patch<Driver>(`/drivers/${id}/notes`, { notes });
}

export { deleteDriver };

export function getDriverActivity(id: string) {
  return api.get<DriverActivity[]>(`/drivers/${id}/activity`);
}
