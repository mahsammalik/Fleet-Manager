import { useEffect, useState } from "react";

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type RentalCompletionModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /**
   * Initial date when the modal opens (YYYY-MM-DD).
   * Pass the rental's planned `rental_end_date` when completing; falls back to today if omitted.
   */
  defaultDate?: string;
  /** YYYY-MM-DD min for date input */
  minDate?: string;
  onConfirm: (completionDate: string) => void | Promise<void>;
  isSubmitting: boolean;
  confirmLabel?: string;
  bulkHint?: string;
};

export function RentalCompletionModal({
  open,
  onClose,
  title,
  description,
  defaultDate,
  minDate,
  onConfirm,
  isSubmitting,
  confirmLabel = "Complete",
  bulkHint,
}: RentalCompletionModalProps) {
  const [date, setDate] = useState("");

  useEffect(() => {
    if (open) {
      setDate(defaultDate ?? localIsoDate(new Date()));
    }
  }, [open, defaultDate]);

  if (!open) {
    return null;
  }

  const handleConfirm = async () => {
    if (!date) return;
    await onConfirm(date);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
        <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
        {description ? <p className="text-sm text-slate-600 mt-2">{description}</p> : null}
        {bulkHint ? <p className="text-sm text-amber-800 mt-2 bg-amber-50 rounded-md px-2 py-1.5">{bulkHint}</p> : null}
        <label className="block text-sm font-medium text-slate-700 mt-4">Completion date</label>
        <input
          type="date"
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={date}
          min={minDate}
          onChange={(e) => setDate(e.target.value)}
        />
        <div className="flex gap-2 mt-4">
          <button
            type="button"
            onClick={() => void handleConfirm()}
            disabled={!date || isSubmitting}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {isSubmitting ? "Saving..." : confirmLabel}
          </button>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function toDateInputValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.split("T")[0];
}
