import { api } from "../lib/api";
import type { Driver } from "./drivers";
import { getDriverWithVehicle, deleteDriver } from "./drivers";

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
  return getDriverWithVehicle(id);
}

export type { Driver };

export function updateDriverNotes(id: string, notes: string | null) {
  return api.patch<Driver>(`/drivers/${id}/notes`, { notes });
}

export { deleteDriver };

export function getDriverActivity(id: string) {
  return api.get<DriverActivity[]>(`/drivers/${id}/activity`);
}

export interface DriverActiveRental {
  rental_id: string;
  vehicle_id: string;
  rental_start_date: string;
  rental_end_date: string;
  status: string;
}

export function getDriverActiveRental(driverId: string) {
  return api.get<DriverActiveRental | null>(`/drivers/${driverId}/active-rental`);
}

export { uploadDriverPhoto } from "./drivers";
