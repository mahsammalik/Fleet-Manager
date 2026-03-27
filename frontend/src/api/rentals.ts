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

export function bulkCompleteOverdueRentals(rentalIds: string[], completionDate?: string) {
  return api.post<{ completed: number; failed: { rentalId: string; message: string }[] }>(
    "/vehicles/rentals/overdue/bulk-complete",
    { rentalIds, completionDate },
  );
}

