import type { DriverCommissionRow } from "./commission";
import { computeCommissionComponents } from "./commission";
import { roundMoney } from "./debtAllocation";

export type CommissionBaseType =
  | "net_income"
  | "gross_income"
  | "net_income_no_tips"
  | "gross_income_no_tips"
  | "net_income_no_bonuses"
  | "gross_income_no_bonuses";

export type CalculatePayoutInput = {
  venituri: number | null;
  tips: number | null;
  taxa_aplicatie: number | null;
  /** Signed daily cash (Plata zilnica cu cash). */
  plata_zilnica_cash: number | null;
  /** TVT when present. */
  transferTotal: number | null;
  /**
   * Same resolved `n` as earningsCommit after gross/fee/net inference (CSV net column).
   */
  resolvedPlatformNet: number | null;
  driver: DriverCommissionRow;
  commission_base_type?: CommissionBaseType;
};

const COMMISSION_BASE_TYPES: CommissionBaseType[] = [
  "net_income",
  "gross_income",
  "net_income_no_tips",
  "gross_income_no_tips",
  "net_income_no_bonuses",
  "gross_income_no_bonuses",
];

export function parseCommissionBaseType(raw: unknown): CommissionBaseType {
  if (typeof raw !== "string" || !raw.trim()) return "net_income";
  const v = raw.trim() as CommissionBaseType;
  return COMMISSION_BASE_TYPES.includes(v) ? v : "net_income";
}

export type CalculatePayoutResult = {
  gross_income: number;
  net_income: number;
  commission_base: number;
  commission_rate: number;
  transfer_commission: number;
  cash_commission: number;
  company_commission: number;
  driver_payout: number;
  commission_type: string;
};

function num(v: number | null | undefined): number {
  return v ?? 0;
}

/**
 * Platform net for transparency ladder from gross (venituri + tips) and signed Taxa aplicatie.
 * Negative fee/rebate: net = gross + taxa. Non-negative: net = gross - taxa. Missing taxa → 0.
 */
export function netIncomeFromGrossAndTaxa(gross: number, taxa_aplicatie: number | null | undefined): number {
  const t = taxa_aplicatie ?? 0;
  if (t < 0) return gross + t;
  return gross - t;
}

/**
 * Transfer-leg commission base. `net_income` preserves legacy parity:
 * COALESCE(transferTotal, resolvedPlatformNet, venituri, 0).
 */
export function resolveTransferCommissionBase(input: CalculatePayoutInput): number {
  const v = num(input.venituri);
  const tips = num(input.tips);
  const grossIncome = v + tips;
  const netLadder = netIncomeFromGrossAndTaxa(grossIncome, input.taxa_aplicatie);
  const netVenituriOnly = netIncomeFromGrossAndTaxa(v, input.taxa_aplicatie);
  const t = input.commission_base_type ?? "net_income";

  switch (t) {
    case "gross_income":
      return grossIncome;
    case "net_income_no_tips":
      return netVenituriOnly;
    case "gross_income_no_tips":
      return v;
    case "net_income_no_bonuses":
      return netLadder;
    case "gross_income_no_bonuses":
      return grossIncome;
    case "net_income":
    default:
      return input.transferTotal ?? input.resolvedPlatformNet ?? input.venituri ?? 0;
  }
}

/** Driver commission_rate column is 0–100 (percent); DB transparency uses fraction. */
export function driverCommissionRateAsFraction(driver: DriverCommissionRow): number {
  const r = Number(driver.commission_rate ?? 0);
  if (!Number.isFinite(r)) return 0;
  return r / 100;
}

/**
 * Glovo-style income ladder + fleet commission (dual leg). `driver_payout` matches earningsCommit parity.
 */
export function calculatePayout(input: CalculatePayoutInput): CalculatePayoutResult {
  const v = num(input.venituri);
  const tips = num(input.tips);
  const gross_income = v + tips;
  const net_income = netIncomeFromGrossAndTaxa(gross_income, input.taxa_aplicatie);
  const commission_base = resolveTransferCommissionBase(input);
  const signedCash = num(input.plata_zilnica_cash);
  const comm = computeCommissionComponents(input.driver, commission_base, signedCash);
  const driver_payout = roundMoney(
    commission_base - comm.transfer_commission - Math.abs(comm.cash_commission),
  );

  return {
    gross_income,
    net_income,
    commission_base,
    commission_rate: driverCommissionRateAsFraction(input.driver),
    transfer_commission: comm.transfer_commission,
    cash_commission: comm.cash_commission,
    company_commission: comm.company_commission,
    driver_payout,
    commission_type: comm.commission_type,
  };
}
