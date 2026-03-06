import { useState } from "react";

export type CommissionType = "percentage" | "fixed_amount" | "hybrid";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function calculateCommission(
  type: CommissionType,
  earnings: number,
  rate: number,
  fixedAmount: number,
  minimumCommission: number
): { companyCommission: number; driverPayout: number } {
  let companyCommission = 0;
  if (type === "percentage") {
    companyCommission = (earnings * rate) / 100;
  } else if (type === "fixed_amount") {
    companyCommission = fixedAmount;
  } else {
    companyCommission = (earnings * rate) / 100 + fixedAmount;
  }
  if (minimumCommission > 0 && companyCommission < minimumCommission) {
    companyCommission = minimumCommission;
  }
  const driverPayout = Math.max(0, earnings - companyCommission);
  return { companyCommission, driverPayout };
}

const TYPE_LABELS: Record<CommissionType, string> = {
  percentage: "Percentage",
  fixed_amount: "Fixed amount",
  hybrid: "Hybrid",
};

export interface CommissionPreviewProps {
  commissionType: CommissionType;
  commissionRate: number;
  fixedCommissionAmount: number;
  minimumCommission?: number;
  exampleEarnings?: number;
}

export function CommissionPreview(props: CommissionPreviewProps) {
  const {
    commissionType,
    commissionRate,
    fixedCommissionAmount,
    minimumCommission = 0,
    exampleEarnings: controlledEarnings,
  } = props;
  const [localEarnings, setLocalEarnings] = useState(controlledEarnings ?? 500);
  const earnings = controlledEarnings ?? localEarnings;
  const { companyCommission, driverPayout } = calculateCommission(
    commissionType,
    earnings,
    commissionRate,
    fixedCommissionAmount,
    minimumCommission
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-semibold text-slate-800">
          Commission preview
        </span>
        <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
          {TYPE_LABELS[commissionType]}
        </span>
      </div>
      {controlledEarnings == null && (
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Example earnings ($)
          </label>
          <input
            type="number"
            min={0}
            step={10}
            className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
            value={localEarnings}
            onChange={(e) =>
              setLocalEarnings(Math.max(0, Number(e.target.value) || 0))
            }
          />
        </div>
      )}
      <div className="space-y-2 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>Gross earnings</span>
          <span className="font-medium text-slate-900">
            {formatCurrency(earnings)}
          </span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Company commission</span>
          <span className="font-medium text-sky-700">
            {formatCurrency(companyCommission)}
          </span>
        </div>
        <div className="flex justify-between text-slate-600 border-t border-slate-200 pt-2">
          <span>Driver payout</span>
          <span className="font-medium text-slate-900">
            {formatCurrency(driverPayout)}
          </span>
        </div>
      </div>
    </div>
  );
}
