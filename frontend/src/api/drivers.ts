import { api } from "../lib/api";

export interface DriverListItem {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string | null;
  employment_status: string;
  commission_rate: string;
  profile_photo_url?: string | null;
  uber_driver_id: string | null;
  bolt_driver_id: string | null;
  glovo_courier_id?: string | null;
  bolt_courier_id?: string | null;
   wolt_courier_id?: string | null;
}

export type CommissionType = "percentage" | "fixed_amount" | "hybrid";

export interface Driver extends DriverListItem {
  date_of_birth: string | null;
  address: string | null;
  license_number: string | null;
  license_expiry: string | null;
  license_class: string | null;
  hire_date: string | null;
  base_commission_rate: string | null;
  commission_type?: CommissionType | null;
  fixed_commission_amount?: string | null;
  minimum_commission?: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  organization_id: string;
  user_id: string | null;
  current_vehicle_id?: string | null;
  current_vehicle_make?: string | null;
  current_vehicle_model?: string | null;
  current_vehicle_license_plate?: string | null;
  current_vehicle_year?: number | null;
  profile_photo_url?: string | null;
  profile_photo_updated_at?: string | null;
  wolt_courier_id?: string | null;
  wolt_courier_verified?: boolean;
  wolt_courier_verified_at?: string | null;
}

export interface CreateDriverPayload {
  firstName: string;
  lastName: string;
  email?: string;
  phone: string;
  dateOfBirth?: string;
  address?: string;
  licenseNumber?: string;
  licenseExpiry?: string;
  licenseClass?: string;
  hireDate?: string;
  employmentStatus?: "active" | "suspended" | "terminated";
  commissionRate?: number;
  baseCommissionRate?: number;
  commissionType?: CommissionType;
  fixedCommissionAmount?: number;
  minimumCommission?: number;
  uberDriverId?: string;
  boltDriverId?: string;
  glovoCourierId?: string;
  boltCourierId?: string;
  woltCourierId?: string;
  notes?: string;
}

export interface GetDriversParams {
  search?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function createDriver(data: CreateDriverPayload) {
  return api.post<Driver>("/drivers", data);
}

export function getDrivers(params?: GetDriversParams) {
  return api.get<DriverListItem[]>("/drivers", { params });
}

export function getDriverById(id: string) {
  return api.get<Driver>(`/drivers/${id}`);
}

export function updateDriver(id: string, data: Partial<CreateDriverPayload>) {
  return api.put<Driver>(`/drivers/${id}`, data);
}

export function deleteDriver(id: string) {
  return api.delete<Driver>(`/drivers/${id}`);
}

export function uploadDriverPhoto(driverId: string, file: File) {
  const formData = new FormData();
  formData.append("photo", file);
  return api.patch<Driver>(`/drivers/${driverId}/photo`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
}
