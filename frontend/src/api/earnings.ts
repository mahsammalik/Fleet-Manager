import { api } from "../lib/api";

export interface EarningsOverviewResponse {
  kpis: {
    pendingPaymentsTotal: number;
    totalEarningsLast30Days: number;
    avgPayoutPaidLast90Days: number;
  };
  monthly: { month: string; totalEarnings: number; totalCommission: number }[];
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
  account_opening_fee: string | null;
  transfer_commission: string | null;
  expected_payout: string | null;
  ok: boolean;
}

export interface EarningsImportListItem {
  id: string;
  file_name: string | null;
  import_date: string;
  week_start: string;
  week_end: string;
  platform: string;
  record_count: number | null;
  status: string;
  created_at: string;
}

export interface EarningsImportsResponse {
  items: EarningsImportListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PayoutListItem {
  id: string;
  driver_id: string;
  payment_period_start: string;
  payment_period_end: string;
  net_driver_payout: string | null;
  payment_status: string;
  payment_date: string | null;
  total_gross_earnings: string | null;
  company_commission: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
}

export interface EarningsPayoutsResponse {
  items: PayoutListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export function getEarningsOverview() {
  return api.get<EarningsOverviewResponse>("/earnings/overview");
}

export function getPayoutIntegrityRows() {
  return api.get<PayoutIntegrityRow[]>("/earnings/records/payout-integrity");
}

export function getEarningsImports(page = 1, pageSize = 20) {
  return api.get<EarningsImportsResponse>("/earnings/imports", { params: { page, pageSize } });
}

export function getEarningsPayouts(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
}) {
  return api.get<EarningsPayoutsResponse>("/earnings/payouts", { params });
}

export function bulkUpdatePayouts(body: {
  ids: string[];
  paymentStatus?: string;
  paymentDate?: string;
  paymentMethod?: string;
  transactionRef?: string;
}) {
  return api.patch<{ updatedRows: number }>("/earnings/payouts/bulk", body);
}

export function downloadEarningsReportCsv(params: { from?: string; to?: string; q?: string; status?: string }) {
  return api.get<Blob>("/earnings/reports/export", {
    params: { ...params, format: "csv" },
    responseType: "blob",
  });
}
