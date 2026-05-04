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
  company_commission: string | null;
  commission_base?: string | null;
  total_transfer_earnings: string | null;
  account_opening_fee: string | null;
  vehicle_rental_fee: string | null;
  vehicle_rental_id: string | null;
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
  platform_id: string | null;
  /** Earnings provider code from `earnings_records.platform` (e.g. uber, glovo). */
  earnings_platform?: string | null;
  driver_name?: string;
  payment_period_start: string;
  payment_period_end: string;
  period_start_label?: string;
  period_end_label?: string;
  net_driver_payout: string | null;
  raw_net_amount: string | null;
  debt_amount: string | null;
  debt_applied_amount: string | null;
  remaining_debt_amount: string | null;
  vehicle_rental_fee: string | null;
  payment_status: string;
  payment_date: string | null;
  total_gross_earnings: string | null;
  /** Period sum of base earnings (income), excluding tips. */
  income: string | null;
  /** Period sum of tips. */
  tips: string | null;
  total_platform_fees: string | null;
  total_daily_cash: string | null;
  /** Fleet commission (single: percent / fixed / hybrid of period net income). */
  company_commission: string | null;
  /** Glovo ladder: income + tips (period sum). */
  gross_income: string | null;
  /** Glovo ladder: gross_income − taxa (period sum). */
  net_income: string | null;
  commission_base: string | null;
  /** Fleet rate as decimal fraction (e.g. 0.2 for 20%). */
  commission_rate: string | null;
  commission_base_type: string | null;
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

export interface EarningsReportRow {
  id: string;
  driver_id: string;
  driver_name: string;
  platform_id: string | null;
  payment_period_start: string;
  payment_period_end: string;
  period_start_label: string;
  period_end_label: string;
  total_gross_earnings: string | null;
  income: string | null;
  tips: string | null;
  total_platform_fees: string | null;
  total_daily_cash: string | null;
  gross_income: string | null;
  net_income: string | null;
  /** Fleet commission (single). */
  company_commission: string | null;
  commission_base: string | null;
  commission_rate: string | null;
  commission_base_type: string | null;
  vehicle_rental_fee: string | null;
  net_driver_payout: string | null;
  raw_net_amount: string | null;
  debt_amount: string | null;
  debt_applied_amount: string | null;
  remaining_debt_amount: string | null;
  payment_status: string;
  payment_date: string | null;
  first_name: string;
  last_name: string;
  phone: string | null;
}

export interface EarningsReportSummary {
  rowCount: number;
  totalNetPayout: number;
  totalVehicleRental: number;
  totalRevenue: number;
  totalDebt: number;
  /** Sum of period company_commission (same as total fleet commission for the report). */
  totalCommissionLegs: number;
  /** Sum of company_commission charged. */
  totalCompanyCommission: number;
}

export interface EarningsReportsResponse {
  items: EarningsReportRow[];
  summary: EarningsReportSummary;
  truncated: boolean;
  limit: number;
}

export interface CommissionByBaseTypeRow {
  commission_base_type: string;
  payoutCount: number;
  totalCompanyCommission: number;
  totalCommissionBase: number;
  avgCommissionRate: number;
}

export interface PayoutProrationDetail {
  payout_id: string;
  vehicle_rental_fee: string | null;
  remaining_debt_amount?: string | null;
  vehicle_rental_id: string | null;
  rental_amount: string | null;
  rental_start_date: string | null;
  rental_end_date: string | null;
  rental_type: string | null;
  overlap_pct: string | null;
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
  driverId?: string;
}) {
  return api.get<EarningsPayoutsResponse>("/earnings/payouts", { params });
}

export function getEarningsReports(params: {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  driverId?: string;
  minVehicleRental?: number;
  limit?: number;
}) {
  return api.get<EarningsReportsResponse>("/earnings/reports", { params });
}

export function getCommissionByBaseTypeReport(params: {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  driverId?: string;
  minVehicleRental?: number;
}) {
  return api.get<{ items: CommissionByBaseTypeRow[] }>("/earnings/reports/commission-by-base-type", { params });
}

export function getPayoutsWithProrationDetails(params: {
  page?: number;
  pageSize?: number;
  status?: string;
  from?: string;
  to?: string;
  q?: string;
  driverId?: string;
}) {
  return api.get<{ items: PayoutProrationDetail[]; page: number; pageSize: number }>(
    "/earnings/payouts/with-proration-details",
    { params },
  );
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

export function downloadEarningsReportCsv(params: {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  driverId?: string;
  minVehicleRental?: number;
}) {
  return api.get<Blob>("/earnings/reports/export", {
    params: { ...params, format: "csv" },
    responseType: "blob",
  });
}

export function getEarningsReportPdfData(params: {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  driverId?: string;
  minVehicleRental?: number;
}) {
  return api.get<EarningsReportsResponse>("/earnings/reports/export", {
    params: { ...params, format: "pdf" },
  });
}

export function syncEarningsVehicleRentals(body?: { importId?: string; driverId?: string }) {
  return api.post<{ retouchedRecords: number; updatedPayouts: number }>("/earnings/sync-vehicles", body ?? {});
}

export interface DebtSummaryResponse {
  totalOutstanding: number;
  driversWithDebt: number;
  topDebtors: { driverId: string; name: string; outstanding: number; oldestPeriodEnd: string | null }[];
}

export function getDebtsSummary() {
  return api.get<DebtSummaryResponse>("/earnings/debts/summary");
}

export type DebtAdjustType = "adjust" | "forgive" | "cash_received" | "carry_forward";

/** Debt-related fields on `driver_payouts` after adjust-debt (post-propagation snapshot). */
export type AdjustDebtPayoutSnapshot = {
  raw_net_amount: string | null;
  debt_amount: string | null;
  debt_applied_amount: string | null;
  remaining_debt_amount: string | null;
  net_driver_payout: string | null;
  payment_status: string;
  updated_at: string | null;
};

export type AdjustDebtResponse = {
  ok: boolean;
  payoutId?: string;
  driverId?: string;
  type: string;
  previousRemaining?: number;
  remainingDebtAmount?: number;
  paymentStatus?: string;
  payout?: AdjustDebtPayoutSnapshot | null;
};

/** `forgive` / `cash_received`: positive amount reduces remaining debt. `adjust`: positive reduces remaining; negative increases (corrections). */
export function postPayoutAdjustDebt(
  payoutId: string,
  body: { type: DebtAdjustType; amount?: number; note?: string | null },
) {
  return api.post<AdjustDebtResponse>(`/earnings/payouts/${encodeURIComponent(payoutId)}/adjust-debt`, body);
}

/** Alias for `postPayoutAdjustDebt` (same endpoint and payload). */
export function adjustDebt(
  payoutId: string,
  body: { type: DebtAdjustType; amount?: number; note?: string | null },
) {
  return postPayoutAdjustDebt(payoutId, body);
}

export function postDebtsBulkCarryForward(body?: { driverIds?: string[]; from?: string; to?: string }) {
  return api.post<{ ok: boolean; driversProcessed: number }>("/earnings/debts/bulk-carry-forward", body ?? {});
}

export function getDebtsAging() {
  return api.get<{
    buckets: Record<string, { total: number; rowCount: number }>;
  }>("/earnings/debts/aging");
}

export function getDebtsCollectionSummary(params: { from: string; to: string }) {
  return api.get<{
    from: string;
    to: string;
    appliedFromPayouts: { periodEnd: string; collected: number }[];
    adjustmentsByType: Record<string, number>;
  }>("/earnings/debts/collection-summary", { params });
}

export function getDebtHistory(driverId: string) {
  return api.get<{
    adjustments: {
      id: string;
      payout_id: string;
      amount: string;
      reason: string | null;
      adjustment_type: string;
      created_at: string;
      period_start: string | null;
      period_end: string | null;
      previous_remaining_debt: string | null;
      new_remaining_debt: string | null;
      applied_amount: string | null;
    }[];
    payouts: {
      id: string;
      payment_period_start: string;
      payment_period_end: string;
      raw_net_amount: string | null;
      debt_amount: string | null;
      remaining_debt_amount: string | null;
      debt_applied_amount: string | null;
      net_driver_payout: string | null;
      payment_status: string;
    }[];
  }>(`/earnings/debts/history/${encodeURIComponent(driverId)}`);
}
