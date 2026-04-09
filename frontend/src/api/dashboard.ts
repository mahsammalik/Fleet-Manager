import { api } from "../lib/api";

export interface DashboardStats {
  totalDrivers: number;
  activeDrivers: number;
  pendingDocuments: number;
  expiredDocuments: number;
  totalCommissionEarned: number;
  pendingPayments: number;
  totalVehicleRentalFees?: number;
  totalVehicles?: number;
  activeRentals?: number;
  overdueRentals?: number;
}

export interface DriverStatusItem {
  status: string;
  count: number;
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

export function getDashboardStats() {
  return api.get<DashboardStats>("/dashboard/stats");
}

export function getDriverStatusDistribution() {
  return api.get<DriverStatusItem[]>("/dashboard/drivers/status");
}

export function getDocumentStats() {
  return api.get<DocumentStatsItem[]>("/dashboard/documents");
}

export function getRecentActivity() {
  return api.get<DashboardActivityItem[]>("/dashboard/activity");
}

