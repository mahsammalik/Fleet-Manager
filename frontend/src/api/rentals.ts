import { api } from "../lib/api";

export interface OverdueRentalItem {
  rental_id: string;
  vehicle_id: string;
  driver_id: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_type: "daily" | "weekly" | "monthly";
  deposit_amount: string | null;
  deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
  deposit_deduction_amount: string | null;
  deposit_deduction_reason: string | null;
  vehicle_make: string;
  vehicle_model: string;
  license_plate: string;
  daily_rent: string;
  driver_first_name: string;
  driver_last_name: string;
  overdue_days: number;
  overdue_amount: string;
  payment_status?: string | null;
  total_rent_amount?: string | null;
  rent_paid_amount?: string | null;
}

export interface OverdueRentalsParams {
  minOverdueDays?: number;
  maxOverdueDays?: number;
  vehicleId?: string;
  driverId?: string;
  limit?: number;
  offset?: number;
}

export function getOverdueRentals(params?: OverdueRentalsParams) {
  return api.get<OverdueRentalItem[]>("/vehicles/rentals/overdue", { params });
}

export function completeOverdueRental(
  rentalId: string,
  data?: { deductionAmount?: number; deductionReason?: string; completionDate?: string },
) {
  return api.post(`/vehicles/rentals/${rentalId}/complete`, data ?? {});
}

export function extendRentalPeriod(rentalId: string, newEndDate: string) {
  return api.post(`/vehicles/rentals/${rentalId}/extend`, { newEndDate });
}

export interface BulkCompleteOverdueRentalsResponse {
  completed: number;
  failed: { rentalId: string; message: string }[];
  processed?: number;
  rentalsTouched?: number;
  rentPaymentsRecorded?: number;
}

export function bulkCompleteOverdueRentals(rentalIds: string[], completionDate?: string) {
  return api.post<BulkCompleteOverdueRentalsResponse>(
    "/vehicles/rentals/overdue/bulk-complete",
    { rentalIds, completionDate },
  );
}

export interface BulkCompleteRentalsRequest {
  rental_ids: string[];
  completion_date?: string;
  reason?: string;
}

export interface BulkCompleteRentalsResponse {
  success: boolean;
  count: number;
  rentals: Record<string, unknown>[];
  rentPaymentsCreated?: number;
  message?: string;
}

export function bulkCompleteRentals(data: BulkCompleteRentalsRequest) {
  return api.post<BulkCompleteRentalsResponse>("/vehicles/rentals/bulk-complete", data);
}

export interface ActiveVehicleRentalRow {
  rental_id: string;
  vehicle_id: string;
  driver_id: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_type: "daily" | "weekly" | "monthly" | null;
  status: string;
  total_rent_amount: string | null;
  license_plate: string;
  driver_first_name: string;
  driver_last_name: string;
}

export function getActiveVehicleRentals(params?: { limit?: number; offset?: number }) {
  return api.get<ActiveVehicleRentalRow[]>("/vehicles/rentals/active", { params });
}

export interface BulkNextWeekRentalsResponse {
  created: number;
  failed: { rentalId: string; message: string }[];
}

export function bulkCreateNextWeekRentals(rental_ids: string[]) {
  return api.post<BulkNextWeekRentalsResponse>("/vehicles/rentals/bulk-next-week", { rental_ids });
}

