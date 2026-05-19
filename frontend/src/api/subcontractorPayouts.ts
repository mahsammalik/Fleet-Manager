import { api } from "../lib/api";

export interface SubcontractorPayoutListItem {
  id: string;
  subcontractor_id: string;
  legal_name: string;
  subcontractor_status: string;
  payment_period_start: string;
  payment_period_end: string;
  driver_payout_count: number;
  total_gross_income: string;
  total_tips: string;
  /** SUM(driver_payouts.company_commission) for linked driver payouts. */
  total_commission: string;
  total_vehicle_rent: string;
  total_account_opening_fee: string;
  total_platform_fees: string;
  total_daily_cash: string;
  total_payable: string;
  amount_payable: string;
  payment_status: string;
  payment_date: string | null;
  payment_method: string | null;
  payment_reference: string | null;
  paid_amount: string | null;
}

export interface SubcontractorPayoutDriverLine {
  id: string;
  driver_id: string;
  first_name: string;
  last_name: string;
  payment_status: string;
  payment_date: string | null;
}

export interface SubcontractorPayoutDetail extends SubcontractorPayoutListItem {
  driverPayouts: SubcontractorPayoutDriverLine[];
}

export function getSubcontractorPayouts(params: {
  periodStart: string;
  periodEnd: string;
  status?: string;
  subcontractorId?: string;
}) {
  return api.get<{ periodStart: string; periodEnd: string; items: SubcontractorPayoutListItem[] }>(
    "/subcontractor-payouts",
    { params },
  );
}

export function getSubcontractorPayoutById(id: string) {
  return api.get<SubcontractorPayoutDetail>(`/subcontractor-payouts/${id}`);
}

export interface SubcontractorSettlementDetailDriver {
  id: string;
  driver_id: string;
  name: string;
  gross: string;
  tips: string;
  commission: string;
  vehicle_rent: string;
  account_opening_fee: string;
  platform_fees: string;
  daily_cash: string;
  net: string;
}

export interface SubcontractorSettlementDetail {
  settlement: {
    id: string;
    subcontractor_id: string;
    subcontractor_name: string;
    period_start: string;
    period_end: string;
    status: string;
    payable: string;
    paid_amount: string | null;
  };
  totals: {
    drivers: number;
    gross_incl_tips: string;
    tips: string;
    commission: string;
    vehicle_rent: string;
    account_opening_fee: string;
    platform_fees: string;
    daily_cash: string;
    payable: string;
  };
  drivers: SubcontractorSettlementDetailDriver[];
  validation: {
    matched: boolean;
    difference: number;
    totals_matched: boolean;
    totals_difference: number;
  };
}

export function getSubcontractorSettlementDetail(id: string) {
  return api.get<SubcontractorSettlementDetail>(`/subcontractor-payouts/${encodeURIComponent(id)}/detail`);
}

export function bulkUpdateSubcontractorPayouts(body: {
  ids: string[];
  paymentStatus?: string;
  paymentDate?: string;
  paymentMethod?: string;
  paymentReference?: string;
  /** @deprecated use paymentReference */
  transactionRef?: string;
}) {
  return api.patch<{ updated: number; ids: string[] }>("/subcontractor-payouts/bulk", body);
}

export function postRefreshSubcontractorPayouts(body: { periodStart: string; periodEnd: string }) {
  return api.post<{
    periodStart: string;
    periodEnd: string;
    updatedRentSubcontractors: number;
    updatedPayoutSettlements: number;
  }>("/subcontractor-payouts/refresh", body);
}
