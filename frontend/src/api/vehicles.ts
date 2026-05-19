import { api } from "../lib/api";

export type VehicleStatus = "available" | "rented" | "maintenance" | "sold" | "scrapped";
export type PaymentStatus = "pending" | "paid" | "partial" | "overdue";
export type MaintenanceStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface VehicleListItem {
  id: string;
  organization_id: string;
  vehicle_type: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  license_plate: string;
  vin: string | null;
  fuel_type: string | null;
  transmission: string | null;
  seating_capacity: number | null;
  daily_rent: string;
  weekly_rent: string;
  monthly_rent: string;
  insurance_expiry: string | null;
  registration_expiry: string | null;
  status: VehicleStatus;
  current_driver_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  driver_first_name?: string | null;
  driver_last_name?: string | null;
  driver_phone?: string | null;
}

export type Vehicle = VehicleListItem;

export interface CreateVehiclePayload {
  vehicleType: string;
  make: string;
  model: string;
  year?: number;
  color?: string;
  licensePlate: string;
  vin?: string;
  fuelType?: string;
  transmission?: string;
  seatingCapacity?: number;
  dailyRent?: number;
  weeklyRent?: number;
  monthlyRent?: number;
  insuranceExpiry?: string;
  registrationExpiry?: string;
  status?: VehicleStatus;
  notes?: string;
}

export interface UpdateVehiclePayload extends Partial<CreateVehiclePayload> {
  currentDriverId?: string | null;
}

export interface VehicleMaintenance {
  id: string;
  vehicle_id: string;
  maintenance_type: string;
  description: string | null;
  cost: string | null;
  scheduled_date: string | null;
  completed_date: string | null;
  status: MaintenanceStatus;
  mechanic_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateMaintenancePayload {
  maintenanceType: string;
  description?: string;
  cost?: number;
  scheduledDate?: string;
  completedDate?: string;
  status?: MaintenanceStatus;
  mechanicName?: string;
  notes?: string;
}

export interface UpdateMaintenancePayload {
  maintenanceType?: string;
  description?: string;
  cost?: number;
  scheduledDate?: string;
  completedDate?: string;
  status?: MaintenanceStatus;
  mechanicName?: string;
  notes?: string;
}

export interface GetVehiclesParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function getVehicles(params?: GetVehiclesParams) {
  return api.get<VehicleListItem[]>("/vehicles", { params });
}

export function searchVehicles(
  q: string,
  params?: Pick<GetVehiclesParams, "status" | "limit" | "offset">,
) {
  return api.get<VehicleListItem[]>("/vehicles/search", { params: { q, ...params } });
}

export function getVehicleById(id: string) {
  return api.get<Vehicle>(`/vehicles/${id}`);
}

export function createVehicle(data: CreateVehiclePayload) {
  return api.post<Vehicle>("/vehicles", data);
}

export function updateVehicle(id: string, data: UpdateVehiclePayload) {
  return api.put<Vehicle>(`/vehicles/${id}`, data);
}

export function deleteVehicle(id: string) {
  return api.delete<{ id: string }>(`/vehicles/${id}`);
}

export function getVehicleMaintenance(vehicleId: string) {
  return api.get<VehicleMaintenance[]>(`/vehicles/${vehicleId}/maintenance`);
}

export function createVehicleMaintenance(vehicleId: string, data: CreateMaintenancePayload) {
  return api.post<VehicleMaintenance>(`/vehicles/${vehicleId}/maintenance`, data);
}

export function updateVehicleMaintenance(
  vehicleId: string,
  maintenanceId: string,
  data: UpdateMaintenancePayload,
) {
  return api.patch<VehicleMaintenance>(`/vehicles/${vehicleId}/maintenance/${maintenanceId}`, data);
}
