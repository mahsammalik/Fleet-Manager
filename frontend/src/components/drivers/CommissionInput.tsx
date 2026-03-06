import type { CommissionType } from "./CommissionPreview";
import { CommissionPreview } from "./CommissionPreview";

const COMMISSION_TYPES: { value: CommissionType; label: string }[] = [
  { value: "percentage", label: "Percentage" },
  { value: "fixed_amount", label: "Fixed amount" },
  { value: "hybrid", label: "Hybrid" },
];

export interface CommissionValues {
  commissionType: CommissionType;
  commissionRate: number;
  fixedCommissionAmount: number;
  minimumCommission: number;
}

export interface CommissionInputProps {
  commissionType: CommissionType;
  commissionRate: number;
  fixedCommissionAmount: number;
  minimumCommission: number;
  onChange: (values: Partial<CommissionValues>) => void;
  errors?: Partial<Record<keyof CommissionValues, string>>;
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500";
const inputErrorClass =
  "w-full rounded-md border border-red-400 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500";

export function CommissionInput({
  commissionType,
  commissionRate,
  fixedCommissionAmount,
  minimumCommission,
  onChange,
  errors = {},
}: CommissionInputProps) {
  const setType = (value: CommissionType) => onChange({ commissionType: value });
  const setRate = (value: number) => onChange({ commissionRate: value });
  const setFixed = (value: number) =>
    onChange({ fixedCommissionAmount: value });
  const setMin = (value: number) => onChange({ minimumCommission: value });

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Commission type
        </label>
        <select
          className={errors.commissionType ? inputErrorClass : inputClass}
          value={commissionType}
          onChange={(e) => setType(e.target.value as CommissionType)}
        >
          {COMMISSION_TYPES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {errors.commissionType && (
          <p className="mt-1 text-xs text-red-600">{errors.commissionType}</p>
        )}
      </div>

      {(commissionType === "percentage" || commissionType === "hybrid") && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Commission rate (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.01}
            className={errors.commissionRate ? inputErrorClass : inputClass}
            value={commissionRate}
            onChange={(e) =>
              setRate(e.target.value === "" ? 0 : Number(e.target.value))
            }
          />
          {errors.commissionRate && (
            <p className="mt-1 text-xs text-red-600">{errors.commissionRate}</p>
          )}
        </div>
      )}

      {(commissionType === "fixed_amount" || commissionType === "hybrid") && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Fixed commission amount (RON)
          </label>
          <input
            type="number"
            min={0}
            step={0.01}
            className={errors.fixedCommissionAmount ? inputErrorClass : inputClass}
            value={fixedCommissionAmount}
            onChange={(e) =>
              setFixed(
                e.target.value === "" ? 0 : Number(e.target.value)
              )
            }
          />
          {errors.fixedCommissionAmount && (
            <p className="mt-1 text-xs text-red-600">
              {errors.fixedCommissionAmount}
            </p>
          )}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Minimum commission (RON) <span className="text-slate-400">optional</span>
        </label>
        <input
          type="number"
          min={0}
          step={0.01}
          className={errors.minimumCommission ? inputErrorClass : inputClass}
          value={minimumCommission}
          onChange={(e) =>
            setMin(e.target.value === "" ? 0 : Number(e.target.value))
          }
        />
        {errors.minimumCommission && (
          <p className="mt-1 text-xs text-red-600">
            {errors.minimumCommission}
          </p>
        )}
      </div>

      <CommissionPreview
        commissionType={commissionType}
        commissionRate={commissionRate}
        fixedCommissionAmount={fixedCommissionAmount}
        minimumCommission={minimumCommission}
      />
    </div>
  );
}
