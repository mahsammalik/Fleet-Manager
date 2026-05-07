export type CommissionType = "percentage" | "fixed_amount" | "hybrid";

export interface DriverCommissionRow {
  commission_type: string;
  commission_rate: string | number | null;
  fixed_commission_amount: string | number | null;
  minimum_commission: string | number | null;
}

export type CompanyCommissionResult = {
  company_commission: number;
  commission_type: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Fleet commission from the chosen **commission base** (per driver rules).
 * Percentage: base × rate/100. Fixed: fixed amount. Hybrid: base × rate/100 + fixed. Then minimum floor.
 */
export function computeCompanyCommissionFromBase(
  driver: DriverCommissionRow,
  commissionBase: number,
): CompanyCommissionResult {
  const type = (driver.commission_type || "percentage") as CommissionType;
  const rate = Number(driver.commission_rate ?? 0);
  const fixedAmount = Number(driver.fixed_commission_amount ?? 0);
  const minimumCommission = Number(driver.minimum_commission ?? 0);
  const safeBase = Math.max(0, commissionBase);

  let companyCommission = 0;

  if (type === "percentage") {
    companyCommission = round2((safeBase * rate) / 100);
  } else if (type === "fixed_amount") {
    companyCommission = round2(fixedAmount);
  } else {
    companyCommission = round2((safeBase * rate) / 100 + fixedAmount);
  }

  if (minimumCommission > 0 && companyCommission < minimumCommission) {
    companyCommission = round2(minimumCommission);
  }

  return {
    company_commission: companyCommission,
    commission_type: type,
  };
}

/** @deprecated Prefer {@link computeCompanyCommissionFromBase} (base may be gross or net). */
export function computeCompanyCommissionFromNetIncome(
  driver: DriverCommissionRow,
  netIncome: number,
): CompanyCommissionResult {
  return computeCompanyCommissionFromBase(driver, netIncome);
}

export function computeCommission(
  driver: DriverCommissionRow,
  earningsBase: number,
): { company_commission: number; driver_payout: number; commission_type: string } {
  const { company_commission, commission_type } = computeCompanyCommissionFromBase(driver, earningsBase);
  const driverPayout = Math.max(0, earningsBase - company_commission);
  return {
    company_commission,
    driver_payout: round2(driverPayout),
    commission_type,
  };
}
