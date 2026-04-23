import { useState } from "react";
import type { DebtAdjustType, PayoutListItem } from "../../api/earnings";
import { postPayoutAdjustDebt } from "../../api/earnings";
import { formatCurrency } from "../../utils/currency";

type DebtActionsModalProps = {
  row: PayoutListItem | null;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function toNum(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function DebtActionsModal({ row, open, onClose, onSuccess }: DebtActionsModalProps) {
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open || !row) return null;

  const remaining = toNum(row.remaining_debt_amount);
  const rawNet = toNum(row.raw_net_amount);

  const resetForm = () => {
    setNote("");
    setAmount("");
    setErr(null);
  };

  const handleClose = () => {
    if (!busy) {
      resetForm();
      onClose();
    }
  };

  const submit = async (type: DebtAdjustType, opts?: { amount?: number }) => {
    setBusy(true);
    setErr(null);
    try {
      await postPayoutAdjustDebt(row.id, {
        type,
        note: note.trim() || undefined,
        amount: opts?.amount,
      });
      resetForm();
      onSuccess();
      onClose();
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "response" in e
          ? String((e as { response?: { data?: { message?: string } } }).response?.data?.message ?? "Request failed")
          : "Request failed";
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      role="dialog"
      aria-modal="true"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-lg font-semibold text-slate-900">Debt actions</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            {row.first_name} {row.last_name} · {row.payment_period_start?.slice(0, 10)} – {row.payment_period_end?.slice(0, 10)}
          </p>
          <p className="text-xs text-slate-500 mt-1 tabular-nums">
            Raw net: {formatCurrency(rawNet)} · Remaining debt: {formatCurrency(remaining)}
          </p>
        </div>

        <div className="px-4 py-3 space-y-3">
          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
            <textarea
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[72px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={busy}
              placeholder="Reason for adjustment…"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount (RON, where needed)</label>
            <input
              type="number"
              step="0.01"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm tabular-nums"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={busy}
              placeholder="e.g. 83.07"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const v = parseFloat(amount);
                if (!Number.isFinite(v)) {
                  setErr("Enter an amount for manual adjust (positive increases remaining debt, negative reduces it).");
                  return;
                }
                void submit("adjust", { amount: v });
              }}
              className="rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
            >
              Adjust debt (delta)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const v = amount.trim() === "" ? undefined : parseFloat(amount);
                if (v !== undefined && (!Number.isFinite(v) || v <= 0)) {
                  setErr("Partial forgive: enter a positive amount, or leave empty to forgive all remaining.");
                  return;
                }
                void submit("forgive", v !== undefined ? { amount: v } : undefined);
              }}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              Forgive (optional partial amount)
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const v = parseFloat(amount);
                if (!Number.isFinite(v) || v <= 0) {
                  setErr("Cash received: enter a positive amount collected from the driver.");
                  return;
                }
                void submit("cash_received", { amount: v });
              }}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
            >
              Cash received
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit("carry_forward")}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Carry forward (re-run full allocation for driver)
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Carry forward rebuilds debt from raw payouts for this driver. Use after data fixes; may reset edge cases on
            forgiven rows.
          </p>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
