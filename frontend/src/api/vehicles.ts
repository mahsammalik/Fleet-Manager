import { api } from "../lib/api";

export type VehicleStatus = "available" | "rented" | "maintenance" | "sold" | "scrapped";
export type RentalType = "daily" | "weekly" | "monthly";
export type RentalStatus = "active" | "completed" | "cancelled" | "overdue";
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

export interface VehicleRental {
  id: string;
  vehicle_id: string;
  driver_id: string;
  organization_id: string;
  rental_start_date: string;
  rental_end_date: string;
  rental_type: RentalType;
  total_rent_amount: string | null;
  deposit_amount: string;
  deposit_status: "pending" | "paid" | "refunded" | "partial" | null;
  deposit_paid_at: string | null;
  deposit_refunded_at: string | null;
  deposit_deduction_amount: string | null;
  deposit_deduction_reason: string | null;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  status: RentalStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  driver_first_name?: string;
  driver_last_name?: string;
}

export interface CreateRentalPayload {
  driverId: string;
  rentalStartDate: string;
  rentalEndDate: string;
  rentalType?: RentalType;
  totalRentAmount?: number;
  depositAmount?: number;
  paymentStatus?: PaymentStatus;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  status?: RentalStatus;
  notes?: string;
}

export interface UpdateRentalPayload {
  status?: RentalStatus;
  /** YYYY-MM-DD; used when completing a rental */
  completionDate?: string;
  paymentStatus?: PaymentStatus;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  depositStatus?: "pending" | "paid" | "refunded" | "partial";
  depositPaidAt?: string;
  depositRefundedAt?: string;
  depositDeductionAmount?: number;
  depositDeductionReason?: string;
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
  status?: string;
  limit?: number;
  offset?: number;
}

export function getVehicles(params?: GetVehiclesParams) {
  return api.get<VehicleListItem[]>("/vehicles", { params });
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

export function getVehicleRentals(vehicleId: string) {
  return api.get<VehicleRental[]>(`/vehicles/${vehicleId}/rentals`);
}

export function createVehicleRental(vehicleId: string, data: CreateRentalPayload) {
  return api.post<VehicleRental>(`/vehicles/${vehicleId}/rentals`, data);
}

export function updateVehicleRental(vehicleId: string, rentalId: string, data: UpdateRentalPayload) {
  return api.patch<VehicleRental>(`/vehicles/${vehicleId}/rentals/${rentalId}`, data);
}

export function markDepositPaid(
  vehicleId: string,
  rentalId: string,
  data: { paymentMethod?: string; paymentReference?: string } = {},
) {
  return updateVehicleRental(vehicleId, rentalId, {
    depositStatus: "paid",
    paymentMethod: data.paymentMethod,
    paymentReference: data.paymentReference,
  });
}

export function refundDeposit(
  vehicleId: string,
  rentalId: string,
  data: { paymentMethod?: string; paymentReference?: string } = {},
) {
  return updateVehicleRental(vehicleId, rentalId, {
    depositStatus: "refunded",
    paymentMethod: data.paymentMethod,
    paymentReference: data.paymentReference,
  });
}

export function deductFromDeposit(
  vehicleId: string,
  rentalId: string,
  data: { amount: number; reason: string; paymentMethod?: string } ,
) {
  return updateVehicleRental(vehicleId, rentalId, {
    depositStatus: "partial",
    depositDeductionAmount: data.amount,
    depositDeductionReason: data.reason,
    paymentMethod: data.paymentMethod,
  });
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
