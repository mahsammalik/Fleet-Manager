import { formatCurrency } from "../../utils/currency";
import type { PayoutIntegrityRow } from "../../api/earnings";

export interface DriverPayoutTableProps {
  rows: PayoutIntegrityRow[];
}

function toNum(v: string | null): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function DriverPayoutTable({ rows }: DriverPayoutTableProps) {
  if (!rows.length) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-slate-900 mb-2">Driver payout integrity</h3>
        <p className="text-sm text-slate-500">No cash-commission rows found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">Driver payout integrity (cash commission)</h3>
      <p className="text-[11px] text-slate-500 mb-3">
        Breakdown shows transfer base (TVT), account opening fee tracked separately (does not change payout math),
        and commissions.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Date</th>
              <th className="px-2 py-2">Platform</th>
              <th className="px-2 py-2 border-l-2 border-amber-200">TVT</th>
              <th className="px-2 py-2 italic text-slate-500" title="Tracked separately; already in TVT">
                Acct. fee
              </th>
              <th className="px-2 py-2">Tfr comm</th>
              <th className="px-2 py-2">Cash Commission</th>
              <th className="px-2 py-2" title="Pro-rated from vehicle rental when trip falls in rental period">
                Vehicle rental
              </th>
              <th className="px-2 py-2">Driver Payout</th>
              <th className="px-2 py-2">Expected</th>
              <th className="px-2 py-2">Delta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const payout = toNum(r.driver_payout);
              const expected = toNum(r.expected_payout);
              const delta = payout - expected;
              const ok = r.ok;
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-2 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
                        ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                      }`}
                    >
                      {ok ? "OK" : "BROKEN"}
                    </span>
                  </td>
                  <td className="px-2 py-2">{r.trip_date}</td>
                  <td className="px-2 py-2">{r.platform}</td>
                  <td className="px-2 py-2 border-l-2 border-amber-100">
                    {r.total_transfer_earnings != null ? formatCurrency(toNum(r.total_transfer_earnings)) : "—"}
                  </td>
                  <td className="px-2 py-2 italic text-slate-600">
                    {r.account_opening_fee != null && toNum(r.account_opening_fee) > 0
                      ? `−${formatCurrency(toNum(r.account_opening_fee))}`
                      : "—"}
                  </td>
                  <td className="px-2 py-2">{formatCurrency(toNum(r.transfer_commission))}</td>
                  <td className="px-2 py-2">{formatCurrency(toNum(r.cash_commission))}</td>
                  <td className="px-2 py-2 text-slate-600">
                    {r.vehicle_rental_fee != null && toNum(r.vehicle_rental_fee) !== 0
                      ? formatCurrency(toNum(r.vehicle_rental_fee))
                      : "—"}
                  </td>
                  <td className="px-2 py-2">{formatCurrency(payout)}</td>
                  <td className="px-2 py-2">{formatCurrency(expected)}</td>
                  <td className={`px-2 py-2 ${Math.abs(delta) > 0.009 ? "text-red-600 font-semibold" : "text-slate-600"}`}>
                    {formatCurrency(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
