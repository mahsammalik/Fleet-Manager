import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { getSubcontractorSettlements } from "../../api/earnings";
import { bulkUpdateSubcontractorPayouts, postRefreshSubcontractorPayouts } from "../../api/subcontractorPayouts";
import { formatCurrency } from "../../utils/currency";

function weekBoundsMonday(d: Date): { start: string; end: string } {
  const day = d.getDay();
  const diff = (day + 6) % 7;
  const mon = new Date(d);
  mon.setDate(d.getDate() - diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(mon), end: iso(sun) };
}

export function SubcontractorSettlementsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const def = weekBoundsMonday(new Date());
  const [periodStart, setPeriodStart] = useState(def.start);
  const [periodEnd, setPeriodEnd] = useState(def.end);
  const [msg, setMsg] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const q = useQuery({
    queryKey: ["earnings", "subcontractor-settlements", periodStart, periodEnd],
    queryFn: () => getSubcontractorSettlements({ periodStart, periodEnd }).then((r) => r.data),
    enabled: (user?.role === "admin" || user?.role === "accountant") && !!periodStart && !!periodEnd,
  });

  const refreshMut = useMutation({
    mutationFn: () => postRefreshSubcontractorPayouts({ periodStart, periodEnd }),
    onSuccess: (r) => {
      setMsg(
        `Refreshed ${r.data.updatedPayoutSettlements} settlement(s) and ${r.data.updatedRentSubcontractors} rent row(s).`,
      );
      void qc.invalidateQueries({ queryKey: ["earnings", "subcontractor-settlements"] });
    },
    onError: () => setMsg("Refresh failed."),
  });

  const payMut = useMutation({
    mutationFn: (ids: string[]) => bulkUpdateSubcontractorPayouts({ ids, paymentStatus: "paid" }),
    onSuccess: (r) => {
      setMsg(`Marked ${r.data.updated} settlement(s) as paid.`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["earnings"] });
    },
    onError: () => setMsg("Mark paid failed."),
  });

  const payableRows =
    q.data?.rows.filter((r) => r.id && Number(r.driver_payout_count ?? 0) > 0) ?? [];

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-end gap-4 justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Subcontractor settlements</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Totals are summed from driver payouts for the period. Payable is the sum of net driver payouts;
              fee columns match each deduction line on the driver payout. Gross incl. tips already includes the
              tips shown in the next column — do not add those columns together. Commission is the sum of{" "}
              <span className="font-mono text-xs">company_commission</span> on each linked driver payout.
            </p>
          </div>
          <Link to="/earnings/payouts" className="text-sm text-sky-700 hover:underline">
            Direct driver payouts
          </Link>
        </div>
      </header>
      <div className="p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Period start</label>
            <input
              type="date"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Period end</label>
            <input
              type="date"
              className="mt-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </div>
          <button
            type="button"
            disabled={refreshMut.isPending}
            onClick={() => {
              setMsg(null);
              refreshMut.mutate();
            }}
            className="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 disabled:opacity-50"
          >
            {refreshMut.isPending ? "Refreshing…" : "Refresh settlements"}
          </button>
          <button
            type="button"
            disabled={payMut.isPending || selected.size === 0}
            onClick={() => payMut.mutate([...selected])}
            className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {payMut.isPending ? "Paying…" : `Mark paid (${selected.size})`}
          </button>
        </div>
        {msg && <p className="text-sm text-slate-700">{msg}</p>}
        {q.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
        {q.isError && <p className="text-sm text-red-700">Failed to load settlements.</p>}
        {q.data && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-2 py-2 w-8" />
                  <th className="px-3 py-2">Subcontractor</th>
                  <th className="px-3 py-2 text-right">Drivers</th>
                  <th
                    className="px-3 py-2 text-right"
                    title="Venit brut incl. bacșiș — Sum of driver gross earnings (income + tips). Tips column is shown separately; do not add Gross incl. tips and Tips together."
                  >
                    Gross incl. tips
                  </th>
                  <th className="px-3 py-2 text-right">Tips</th>
                  <th className="px-3 py-2 text-right" title="Sum of company_commission on each driver payout">
                    Commission
                  </th>
                  <th className="px-3 py-2 text-right">Vehicle rent</th>
                  <th className="px-3 py-2 text-right">Acct. fee</th>
                  <th className="px-3 py-2 text-right">Platform fee</th>
                  <th className="px-3 py-2 text-right">Daily cash</th>
                  <th className="px-3 py-2 text-right">Payable</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.rows.map((r) => {
                  const rowKey = r.id ?? r.subcontractor_id;
                  const canPay = !!r.id && r.payment_status !== "paid";
                  const payable = Number(r.total_payable ?? r.amount_payable ?? 0);
                  return (
                    <tr key={rowKey} className={!r.id ? "opacity-60" : undefined}>
                      <td className="px-2 py-2">
                        {r.id && (
                          <input
                            type="checkbox"
                            checked={selected.has(r.id)}
                            disabled={!canPay}
                            onChange={() => toggleOne(r.id!)}
                            className="rounded border-slate-300"
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-900">
                        {r.id ? (
                          <Link
                            to={`/earnings/subcontractors/settlements/${r.id}`}
                            className="text-sky-700 hover:underline"
                          >
                            {r.legal_name}
                          </Link>
                        ) : (
                          <span title="Refresh settlements to open detail">{r.legal_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.driver_payout_count ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_gross_income ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_tips ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_commission ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_vehicle_rent ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_account_opening_fee ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_platform_fees ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(Number(r.total_daily_cash ?? 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-slate-900">
                        <span className="block">
                          {formatCurrency(payable)}
                          {r.payment_status === "paid" &&
                            r.paid_amount != null &&
                            Math.abs(Number(r.paid_amount) - payable) > 0.01 && (
                              <span className="block text-xs font-normal text-amber-700">
                                Paid {formatCurrency(Number(r.paid_amount))}
                              </span>
                            )}
                        </span>
                      </td>
                      <td className="px-3 py-2 capitalize text-slate-700">{r.payment_status ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {payableRows.length === 0 && q.data.rows.length > 0 && (
              <p className="text-sm text-slate-500 p-4">
                No settlements for this period yet. Import earnings or click Refresh settlements.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
