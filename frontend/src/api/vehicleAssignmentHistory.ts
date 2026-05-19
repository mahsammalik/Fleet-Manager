import { api } from "../lib/api";

export type AssignmentHistoryStatus = "all" | "active" | "returned";

export interface VehicleAssignmentHistoryParams {
  status?: AssignmentHistoryStatus;
  from?: string;
  to?: string;
  q?: string;
}

export interface VehicleAssignmentHistoryRow {
  id: string;
  driver_id: string;
  vehicle_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  weekly_rent_at_time: string | null;
  notes: string | null;
  vehicle_name: string;
  license_plate: string | null;
  make: string | null;
  model: string | null;
  driver_name: string;
  driver_phone: string | null;
  days_held: number;
  total_rent_paid: string;
  assigned_by_name: string | null;
  unassigned_by_name: string | null;
  is_active: boolean;
}

export interface RecentAssignmentRow {
  id: string;
  driver_id: string;
  vehicle_id: string;
  assigned_at: string;
  unassigned_at: string | null;
  weekly_rent_at_time: string | null;
  driver_name: string;
  license_plate: string | null;
  vehicle_name: string;
  is_active: boolean;
}

function buildParams(params?: VehicleAssignmentHistoryParams): Record<string, string> {
  const out: Record<string, string> = {};
  if (!params) return out;
  if (params.status && params.status !== "all") out.status = params.status;
  if (params.from) out.from = params.from;
  if (params.to) out.to = params.to;
  if (params.q?.trim()) out.q = params.q.trim();
  return out;
}

export function getDriverVehicleHistory(driverId: string, params?: VehicleAssignmentHistoryParams) {
  return api.get<{ items: VehicleAssignmentHistoryRow[] }>(
    `/drivers/${driverId}/vehicle-history`,
    { params: buildParams(params) },
  );
}

export function getVehicleDriverHistory(vehicleId: string, params?: VehicleAssignmentHistoryParams) {
  return api.get<{ items: VehicleAssignmentHistoryRow[] }>(
    `/vehicles/${vehicleId}/driver-history`,
    { params: buildParams(params) },
  );
}

export function getRecentAssignments(limit = 5) {
  return api.get<{ items: RecentAssignmentRow[] }>("/dashboard/recent-assignments", {
    params: { limit: String(limit) },
  });
}
