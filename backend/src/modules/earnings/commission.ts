export type CommissionType = "percentage" | "fixed_amount" | "hybrid";

export interface DriverCommissionRow {
  commission_type: string;
  commission_rate: string | number | null;
  fixed_commission_amount: string | number | null;
  minimum_commission: string | number | null;
}

export interface CommissionComponentsResult {
  transfer_commission: number;
  cash_commission: number;
  company_commission: number;
  commission_type: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** `cash_commission` is rate × signed daily cash; earnings commit / DB payout subtract `ABS(cash_commission)` for driver_net. */
export function computeCommissionComponents(
  driver: DriverCommissionRow,
  transferAmount: number,
  signedCashAmount: number,
): CommissionComponentsResult {
  const type = (driver.commission_type || "percentage") as CommissionType;
  const rate = Number(driver.commission_rate ?? 0);
  const fixedAmount = Number(driver.fixed_commission_amount ?? 0);
  const minimumCommission = Number(driver.minimum_commission ?? 0);

  let transferCommission = 0;
  let cashCommission = 0;
  let companyCommission = 0;

  if (type === "percentage") {
    transferCommission = (transferAmount * rate) / 100;
    cashCommission = (signedCashAmount * rate) / 100;
    companyCommission = transferCommission + cashCommission;
  } else if (type === "fixed_amount") {
    companyCommission = fixedAmount;
  } else {
    transferCommission = (transferAmount * rate) / 100;
    cashCommission = (signedCashAmount * rate) / 100;
    companyCommission = transferCommission + cashCommission + fixedAmount;
  }

  if (minimumCommission > 0 && companyCommission < minimumCommission) {
    companyCommission = minimumCommission;
  }

  return {
    transfer_commission: round2(transferCommission),
    cash_commission: round2(cashCommission),
    company_commission: round2(companyCommission),
    commission_type: type,
  };
}

export function computeCommission(
  driver: DriverCommissionRow,
  earningsBase: number,
): { company_commission: number; driver_payout: number; commission_type: string } {
  const components = computeCommissionComponents(driver, earningsBase, 0);
  const driverPayout = Math.max(0, earningsBase - components.company_commission);
  return {
    company_commission: components.company_commission,
    driver_payout: round2(driverPayout),
    commission_type: components.commission_type,
  };
}
