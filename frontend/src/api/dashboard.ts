import { api } from "../lib/api";

export interface DashboardStats {
  totalDrivers: number;
  activeDrivers: number;
  pendingDocuments: number;
  expiredDocuments: number;
  totalCommissionEarned: number;
  pendingPayments: number;
  totalVehicles?: number;
  activeRentals?: number;
  overdueRentals?: number;
}

export interface DriverStatusItem {
  status: string;
  count: number;
}

export interface MonthlyEarningsItem {
  month: string;
  totalEarnings?: number;
  totalCommission?: number;
}

export interface DocumentStatsItem {
  documentType: string;
  total: number;
  verified: number;
  pending: number;
}

export interface DashboardActivityItem {
  id: string;
  driver_id: string;
  activity_type: string;
  activity_description: string | null;
  performed_by: string | null;
  created_at: string;
}

export interface PayoutIntegrityRow {
  id: string;
  driver_id: string;
  trip_date: string;
  platform: string;
  net_earnings: string | null;
  driver_payout: string | null;
  cash_commission: string | null;
  total_transfer_earnings: string | null;
  /** Positive magnitude; informational-only, already in TVT */
  account_opening_fee: string | null;
  transfer_commission: string | null;
  expected_payout: string | null;
  ok: boolean;
}

export function getDashboardStats() {
  return api.get<DashboardStats>("/dashboard/stats");
}

export function getDriverStatusDistribution() {
  return api.get<DriverStatusItem[]>("/dashboard/drivers/status");
}

export function getMonthlyEarnings() {
  return api.get<MonthlyEarningsItem[]>("/dashboard/earnings/monthly");
}

export function getDocumentStats() {
  return api.get<DocumentStatsItem[]>("/dashboard/documents");
}

export function getRecentActivity() {
  return api.get<DashboardActivityItem[]>("/dashboard/activity");
}

export function getPayoutIntegrityRows() {
  return api.get<PayoutIntegrityRow[]>("/dashboard/earnings/payout-integrity");
}
