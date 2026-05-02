import { useEffect, useMemo, useState } from "react";
import type { EarningsReportRow } from "../../api/earnings";
import { formatCurrency } from "../../utils/currency";
import { commissionBaseTypeLabel } from "../../utils/commissionBaseLabels";

type SortKey = "driver" | "period" | "revenue" | "commission" | "rental" | "payout" | "debt" | "status";

type SortState = {
  key: SortKey;
  dir: "asc" | "desc";
};

type EarningsReportsPreviewTableProps = {
  rows: EarningsReportRow[];
  loading?: boolean;
  onVisibleRowsChange?: (rows: EarningsReportRow[]) => void;
};

const scrollShellClass =
  "max-h-[65vh] overflow-auto overscroll-y-contain overscroll-x-none scroll-smooth " +
  "[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgb(148_163_184)_rgb(241_245_249)] " +
  "[&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100/90 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "[&::-webkit-scrollbar-thumb]:hover:bg-slate-400";

function asNumber(v: string | null): number {
  if (v == null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function statusClass(status: string) {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-800";
    case "approved":
      return "bg-sky-100 text-sky-800";
    case "processing":
      return "bg-violet-100 text-violet-800";
    case "failed":
      return "bg-rose-100 text-rose-800";
    case "hold":
      return "bg-amber-100 text-amber-900";
    case "debt":
      return "bg-red-100 text-red-800";
    case "pending":
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function EarningsReportsPreviewTable({
  rows,
  loading = false,
  onVisibleRowsChange,
}: EarningsReportsPreviewTableProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortState>({ key: "period", dir: "desc" });

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? rows.filter((r) => {
          const hay = [
            r.driver_name,
            r.first_name,
            r.last_name,
            r.phone ?? "",
            r.platform_id ?? "",
            r.payment_status,
            r.period_start_label,
            r.period_end_label,
          ]
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        })
      : rows;

    const sorted = [...filtered].sort((a, b) => {
      const dir = sort.dir === "asc" ? 1 : -1;
      if (sort.key === "driver") return a.driver_name.localeCompare(b.driver_name) * dir;
      if (sort.key === "status") return a.payment_status.localeCompare(b.payment_status) * dir;
      if (sort.key === "period")
        return a.payment_period_start.localeCompare(b.payment_period_start) * dir;
      if (sort.key === "revenue")
        return (asNumber(a.total_gross_earnings) - asNumber(b.total_gross_earnings)) * dir;
      if (sort.key === "commission")
        return (asNumber(a.company_commission) - asNumber(b.company_commission)) * dir;
      if (sort.key === "rental")
        return (asNumber(a.vehicle_rental_fee) - asNumber(b.vehicle_rental_fee)) * dir;
      if (sort.key === "debt")
        return (asNumber(a.remaining_debt_amount) - asNumber(b.remaining_debt_amount)) * dir;
      return (asNumber(a.net_driver_payout) - asNumber(b.net_driver_payout)) * dir;
    });
    return sorted;
  }, [rows, search, sort]);

  useEffect(() => {
    onVisibleRowsChange?.(visibleRows);
  }, [visibleRows, onVisibleRowsChange]);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  function sortLabel(key: SortKey) {
    if (sort.key !== key) return "";
    return sort.dir === "asc" ? " ↑" : " ↓";
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          <label htmlFor="reports-table-search" className="mb-1 block text-xs font-medium text-slate-600">
            Search preview rows
          </label>
          <input
            id="reports-table-search"
            type="search"
            className="w-full rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-sm"
            placeholder="Driver, phone, platform ID, debt, period"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading}
          />
        </div>
        <p className="text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-700">{visibleRows.length.toLocaleString()}</span> of{" "}
          {rows.length.toLocaleString()} rows
        </p>
      </div>

      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2.5 text-left text-sm font-medium text-slate-800 shadow-sm md:hidden"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <span>Live table preview</span>
        <span className="text-slate-400" aria-hidden>
          {mobileOpen ? "▾" : "▸"}
        </span>
      </button>

      <div className={`${mobileOpen ? "block" : "hidden"} overflow-x-auto rounded-xl border border-slate-200/80 bg-white/50 md:block`}>
        <div className={scrollShellClass}>
          <table className="min-w-[1580px] w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 text-slate-600 shadow-[0_1px_0_rgb(226_232_240)]">
              <tr>
                <th className="px-3 py-2.5">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("driver")}>
                    Driver{sortLabel("driver")}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("period")}>
                    Period{sortLabel("period")}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">Income</th>
                <th className="px-3 py-2.5 text-right">Tips</th>
                <th className="px-3 py-2.5 text-right">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("revenue")}>
                    Total gross{sortLabel("revenue")}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button
                    type="button"
                    className="font-medium hover:text-slate-900"
                    onClick={() => toggleSort("commission")}
                  >
                    Commission{sortLabel("commission")}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right" title="Sum of commission base for the period">
                  Comm. base
                </th>
                <th className="px-3 py-2.5 text-right" title="Driver nominal rate (decimal fraction)">
                  Rate
                </th>
                <th className="px-3 py-2.5 text-left max-w-[140px]" title="Org import setting snapshot">
                  Base type
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("rental")}>
                    Vehicle Rental{sortLabel("rental")}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("payout")}>
                    Net Payout{sortLabel("payout")}
                  </button>
                </th>
                <th className="px-3 py-2.5 text-right">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("debt")}>
                    Remaining Debt{sortLabel("debt")}
                  </button>
                </th>
                <th className="px-3 py-2.5">
                  <button type="button" className="font-medium hover:text-slate-900" onClick={() => toggleSort("status")}>
                    Status{sortLabel("status")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-sm text-slate-500">
                    Loading live preview...
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-3 py-10 text-center text-sm text-slate-500">
                    No rows match the current filters.
                  </td>
                </tr>
              ) : (
                visibleRows.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50/80">
                    <td className="px-3 py-2">
                      <p className="font-medium text-slate-900">{row.driver_name}</p>
                      <p className="text-[11px] text-slate-500">{row.phone ?? "No phone"}</p>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {row.period_start_label} - {row.period_end_label}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(asNumber(row.income))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(asNumber(row.tips))}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(asNumber(row.total_gross_earnings))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(asNumber(row.company_commission))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatCurrency(asNumber(row.commission_base))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {(() => {
                        const r = asNumber(row.commission_rate);
                        if (!(r > 0)) return "—";
                        return r <= 1 ? `${(r * 100).toFixed(2).replace(/\.?0+$/, "")}%` : `${r}%`;
                      })()}
                    </td>
                    <td className="px-3 py-2 text-[11px] leading-snug text-slate-600 max-w-[140px]">
                      {commissionBaseTypeLabel(row.commission_base_type)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatCurrency(asNumber(row.vehicle_rental_fee))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {formatCurrency(asNumber(row.net_driver_payout))}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-red-700">
                      {formatCurrency(asNumber(row.remaining_debt_amount))}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${statusClass(row.payment_status)}`}>
                        {row.payment_status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
