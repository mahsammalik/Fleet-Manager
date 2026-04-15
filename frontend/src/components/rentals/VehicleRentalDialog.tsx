import { useState } from "react";
import type { DriverListItem } from "../../api/drivers";
import type { CreateRentalPayload } from "../../api/vehicles";
import { formatCurrency } from "../../utils/currency";
import { DriverSearchCombobox } from "./DriverSearchCombobox";

export type VehicleRentalDialogMode = "add";

export type VehicleRentalDialogProps = {
  mode?: VehicleRentalDialogMode;
  dailyRent: number;
  weeklyRent: number;
  monthlyRent: number;
  onClose: () => void;
  onSubmit: (payload: CreateRentalPayload) => void;
  isSubmitting: boolean;
};

export function VehicleRentalDialog({
  dailyRent,
  weeklyRent,
  monthlyRent,
  onClose,
  onSubmit,
  isSubmitting,
}: VehicleRentalDialogProps) {
  const [selectedDriver, setSelectedDriver] = useState<DriverListItem | null>(null);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [rentalType, setRentalType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [depositAmount, setDepositAmount] = useState(0);
  const [notes, setNotes] = useState("");

  const totalAmount =
    rentalType === "daily" ? dailyRent : rentalType === "weekly" ? weeklyRent : monthlyRent;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const driverId = selectedDriver?.id;
    if (!driverId || !startDate || !endDate) return;
    onSubmit({
      driverId,
      rentalStartDate: startDate,
      rentalEndDate: endDate,
      rentalType,
      totalRentAmount: totalAmount,
      depositAmount: depositAmount || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 md:items-center md:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative z-10 flex max-h-full w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl md:max-h-[90vh] md:rounded-xl md:shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 md:border-0 md:px-6 md:pt-6 md:pb-0">
          <h3 className="text-lg font-semibold text-slate-900">Add rental</h3>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 md:hidden"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-2 md:px-6 md:pb-6 md:pt-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <DriverSearchCombobox value={selectedDriver} onChange={setSelectedDriver} disabled={isSubmitting} />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Start date *</label>
                <input
                  type="date"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">End date *</label>
                <input
                  type="date"
                  required
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Rental type</label>
              <select
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={rentalType}
                onChange={(e) => setRentalType(e.target.value as "daily" | "weekly" | "monthly")}
                disabled={isSubmitting}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
              <p className="text-xs text-slate-500 mt-1">Amount: {formatCurrency(totalAmount)} (RON)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Deposit (RON)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={depositAmount || ""}
                onChange={(e) => setDepositAmount(parseFloat(e.target.value) || 0)}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
              <textarea
                rows={2}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isSubmitting}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {isSubmitting ? "Creating..." : "Create rental"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
