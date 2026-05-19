export type SettlementDetailDriverRow = {
  gross: number;
  tips: number;
  commission: number;
  vehicle_rent: number;
  account_opening_fee: number;
  platform_fees: number;
  daily_cash: number;
  net: number;
};

export type SettlementDetailParentTotals = {
  gross_incl_tips: number;
  tips: number;
  commission: number;
  vehicle_rent: number;
  account_opening_fee: number;
  platform_fees: number;
  daily_cash: number;
  payable: number;
};

export type SettlementDetailValidation = {
  matched: boolean;
  difference: number;
  totals_matched: boolean;
  totals_difference: number;
};

const TOLERANCE = 0.01;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function sumField(rows: SettlementDetailDriverRow[], key: keyof SettlementDetailDriverRow): number {
  return round2(rows.reduce((acc, r) => acc + r[key], 0));
}

/** Validate driver breakdown sums against parent settlement totals. */
export function validateSettlementDetail(
  drivers: SettlementDetailDriverRow[],
  parent: SettlementDetailParentTotals,
): SettlementDetailValidation {
  const sumNet = sumField(drivers, "net");
  const payable = round2(parent.payable);
  const netDiff = round2(sumNet - payable);
  const matched = Math.abs(netDiff) <= TOLERANCE;

  const deltas = [
    Math.abs(sumField(drivers, "gross") - round2(parent.gross_incl_tips)),
    Math.abs(sumField(drivers, "tips") - round2(parent.tips)),
    Math.abs(sumField(drivers, "commission") - round2(parent.commission)),
    Math.abs(sumField(drivers, "vehicle_rent") - round2(parent.vehicle_rent)),
    Math.abs(sumField(drivers, "account_opening_fee") - round2(parent.account_opening_fee)),
    Math.abs(sumField(drivers, "platform_fees") - round2(parent.platform_fees)),
    Math.abs(sumField(drivers, "daily_cash") - round2(parent.daily_cash)),
  ];
  const totals_difference = round2(Math.max(...deltas, 0));
  const totals_matched = deltas.every((d) => d <= TOLERANCE);

  return {
    matched,
    difference: netDiff,
    totals_matched,
    totals_difference,
  };
}
