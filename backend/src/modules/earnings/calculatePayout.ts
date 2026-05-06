import type { DriverCommissionRow } from "./commission";
import { computeCompanyCommissionFromBase } from "./commission";
import { roundMoney } from "./debtAllocation";

export type CommissionBaseType =
  | "net_income"
  | "gross_income"
  | "net_income_no_tips"
  | "gross_income_no_tips"
  | "net_income_no_bonuses"
  | "gross_income_no_bonuses";

export type CalculatePayoutInput = {
  /** Base earnings from import (CSV "Venituri" → canonical gross). */
  income: number | null;
  tips: number | null;
  taxa_aplicatie: number | null;
  /**
   * Daily cash from import (may be negative in CSV). Payout always subtracts **magnitude**:
   * `net_income - company_commission - ABS(value)`.
   */
  plata_zilnica_cash: number | null;
  /** TVT when present (stored on row; not used for fleet commission math). */
  transferTotal: number | null;
  /**
   * Same resolved `n` as earningsCommit after gross/fee/net inference (CSV net column).
   */
  resolvedPlatformNet: number | null;
  driver: DriverCommissionRow;
  /** Which amount fleet commission is calculated on (org Glovo import setting). */
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

/** Short labels for UI / audit copy. */
export function commissionBaseTypeLabel(t: CommissionBaseType): string {
  switch (t) {
    case "net_income":
      return "Net income (after platform fee)";
    case "gross_income":
      return "Gross income (income + tips)";
    case "net_income_no_tips":
      return "Net income without tips";
    case "gross_income_no_tips":
      return "Base income without tips";
    case "net_income_no_bonuses":
      return "Net income (no bonuses)";
    case "gross_income_no_bonuses":
      return "Gross income (no bonuses)";
    default:
      return t;
  }
}

export type CalculatePayoutResult = {
  gross_income: number;
  net_income: number;
  /** Amount fleet commission was calculated on (see `commission_base_type` on payout rollup). */
  commission_base: number;
  commission_rate: number;
  company_commission: number;
  driver_payout: number;
  commission_type: string;
};

function num(v: number | null | undefined): number {
  return v ?? 0;
}

/**
 * Platform net from gross (income + tips) and signed Taxa aplicatie.
 * Negative fee/rebate: net = gross + taxa. Non-negative: net = gross - taxa. Missing taxa → 0.
 */
export function netIncomeFromGrossAndTaxa(gross: number, taxa_aplicatie: number | null | undefined): number {
  const t = Math.abs(taxa_aplicatie ?? 0);
  return gross - t;
}

/**
 * Numeric base for fleet commission from org `commission_base_type` and row amounts.
 * Payout line still uses {@link netIncomeFromGrossAndTaxa} on full gross; this only selects the commission numerator.
 */
export function resolveFleetCommissionBase(input: CalculatePayoutInput): number {
  const v = num(input.income);
  const tips = num(input.tips);
  const grossIncome = v + tips;
  const platformNet = netIncomeFromGrossAndTaxa(grossIncome, input.taxa_aplicatie);
  const netIncomeNoTips = netIncomeFromGrossAndTaxa(v, input.taxa_aplicatie);
  const t = input.commission_base_type ?? "net_income";

  switch (t) {
    case "gross_income":
    case "gross_income_no_bonuses":
      return grossIncome;
    case "gross_income_no_tips":
      return v;
    case "net_income_no_tips":
      return netIncomeNoTips;
    case "net_income_no_bonuses":
    case "net_income":
    default:
      return platformNet;
  }
}

/** Driver commission_rate column is 0–100 (percent); transparency uses fraction. */
export function driverCommissionRateAsFraction(driver: DriverCommissionRow): number {
  const r = Number(driver.commission_rate ?? 0);
  if (!Number.isFinite(r)) return 0;
  return r / 100;
}

/**
 * Fleet commission on {@link resolveFleetCommissionBase};
 * driver_payout = platform net_income − company_commission − **ABS(daily cash)** (cash is always a deduction magnitude).
 */
export function calculatePayout(input: CalculatePayoutInput): CalculatePayoutResult {
  const v = num(input.income);
  const tips = num(input.tips);
  const gross_income = v + tips;
  const net_income = netIncomeFromGrossAndTaxa(gross_income, input.taxa_aplicatie);
  const dailyCashDeduction = Math.abs(num(input.plata_zilnica_cash));
  const commission_base = resolveFleetCommissionBase(input);
  const comm = computeCompanyCommissionFromBase(input.driver, commission_base);
  const driver_payout = roundMoney(net_income - comm.company_commission - dailyCashDeduction);

  return {
    gross_income,
    net_income,
    commission_base,
    commission_rate: driverCommissionRateAsFraction(input.driver),
    company_commission: comm.company_commission,
    driver_payout,
    commission_type: comm.commission_type,
  };
}
