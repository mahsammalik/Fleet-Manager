import { useEffect, useMemo, useRef, useState } from "react";
import type { EarningsPreviewAggregates, EarningsPreviewRow } from "../../api/earningsImport";
import { fetchEarningsPreviewRows } from "../../api/earningsImport";
import { formatCurrency } from "../../utils/currency";

const MATCH_LABEL: Record<string, string> = {
  courier_id: "Courier ID",
  phone: "Phone",
  plate: "Plate",
  none: "No match",
};

const CHUNK = 1000;

function rowIsValidForCommit(r: EarningsPreviewRow): boolean {
  const hasMoney = r.gross != null || r.net != null || r.transferTotal != null;
  return r.driverMatched && Boolean(r.tripDate) && hasMoney;
}

function rowHasFeeWarning(r: EarningsPreviewRow): boolean {
  return r.accountOpeningFee != null && r.accountOpeningFee > 0;
}

function rowHasDebtSignal(r: EarningsPreviewRow): boolean {
  if (r.negativeTransferTotal) return true;
  return r.transferTotal != null && r.transferTotal < 0;
}

/** Excel-aligned: negatives stay negative in UI (red, bold). */
function moneyCellClass(n: number | null | undefined): string {
  const base = "whitespace-nowrap px-2 py-1.5 tabular-nums";
  if (n == null) return base;
  if (n < 0) return `${base} font-bold text-red-700`;
  return base;
}

type StatusFilter = "all" | "valid" | "invalid" | "warnings" | "debt_tvt";

const scrollShellClass =
  "max-h-[70vh] overflow-auto overscroll-y-contain overscroll-x-none scroll-smooth " +
  "[scrollbar-gutter:stable] [scrollbar-width:thin] [scrollbar-color:rgb(148_163_184)_rgb(241_245_249)] " +
  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-slate-100/90 " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-slate-300 " +
  "[&::-webkit-scrollbar-thumb]:hover:bg-slate-400 will-change-scroll";

export type EarningsImportPreviewVirtualTableProps = {
  importId: string;
  totalRows: number;
  aggregates?: EarningsPreviewAggregates;
  matchedPreviewCount: number;
};

export function EarningsImportPreviewVirtualTable({
  importId,
  totalRows,
  aggregates,
  matchedPreviewCount,
}: EarningsImportPreviewVirtualTableProps) {
  const mapRef = useRef<Map<number, EarningsPreviewRow>>(new Map());
  const [loadedCount, setLoadedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mobileTableOpen, setMobileTableOpen] = useState(false);

  useEffect(() => {
    mapRef.current = new Map();
    setLoadedCount(0);
    setLoading(true);
    setLoadError(null);
    setComplete(false);
    setMobileTableOpen(false);

    if (!importId || totalRows <= 0) {
      setLoading(false);
      setComplete(true);
      return;
    }

    let cancelled = false;

    async function loadAll() {
      try {
        for (let offset = 0; offset < totalRows; offset += CHUNK) {
          if (cancelled) return;
          const limit = Math.min(CHUNK, totalRows - offset);
          const { data } = await fetchEarningsPreviewRows(importId, offset, limit);
          for (const row of data.rows) {
            mapRef.current.set(row.rowIndex, row);
          }
          setLoadedCount(Math.min(offset + data.rows.length, totalRows));
        }
        if (!cancelled) {
          setComplete(true);
        }
      } catch {
        if (!cancelled) {
          setLoadError("Could not load preview rows. Try canceling and uploading again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [importId, totalRows]);

  const allRows = useMemo(() => {
    if (!complete || totalRows <= 0) return [] as (EarningsPreviewRow | undefined)[];
    const arr: (EarningsPreviewRow | undefined)[] = new Array(totalRows);
    for (let i = 0; i < totalRows; i++) {
      arr[i] = mapRef.current.get(i);
    }
    return arr;
  }, [complete, totalRows]);

  const filteredRows = useMemo(() => {
    if (!complete) return [] as EarningsPreviewRow[];
    const q = searchQuery.trim().toLowerCase();
    const out: EarningsPreviewRow[] = [];
    for (let i = 0; i < allRows.length; i++) {
      const r = allRows[i];
      if (!r) continue;
      if (statusFilter === "valid" && !rowIsValidForCommit(r)) continue;
      if (statusFilter === "invalid" && rowIsValidForCommit(r)) continue;
      if (statusFilter === "warnings" && !rowHasFeeWarning(r)) continue;
      if (statusFilter === "debt_tvt" && !rowHasDebtSignal(r)) continue;
      if (q) {
        const hay = [
          String(r.rowIndex + 1),
          r.tripDate ?? "",
          r.hints?.courierId ?? "",
          r.hints?.phone ?? "",
          r.hints?.plate ?? "",
          r.tips != null ? String(r.tips) : "",
          MATCH_LABEL[r.matchMethod] ?? r.matchMethod,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) continue;
      }
      out.push(r);
    }
    return out;
  }, [allRows, complete, searchQuery, statusFilter]);

  const agg = aggregates ?? {
    valid: matchedPreviewCount,
    invalid: Math.max(0, totalRows - matchedPreviewCount),
    warnings: 0,
    debtRows: 0,
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-xl border border-white/40 bg-white/60 px-3 py-2 text-sm shadow-sm backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-500">Rows loaded</p>
          <p className="mt-0.5 font-semibold tabular-nums text-slate-900">
            {loading ? (
              <>
                {loadedCount.toLocaleString()} / {totalRows.toLocaleString()}
              </>
            ) : (
              <>{totalRows.toLocaleString()}</>
            )}
          </p>
          <p className="mt-1 text-[11px] text-slate-500">
            Showing {complete ? filteredRows.length.toLocaleString() : "—"} rows
            {searchQuery || statusFilter !== "all" ? " (filtered)" : ""}
          </p>
        </div>
        <div className="rounded-xl border border-emerald-100/80 bg-emerald-50/50 px-3 py-2 text-sm shadow-sm backdrop-blur-sm">
          <p className="text-xs font-medium text-emerald-800">Valid (importable)</p>
          <p className="mt-0.5 font-semibold tabular-nums text-emerald-900">{agg.valid.toLocaleString()}</p>
          <p className="mt-1 text-[11px] text-emerald-800/80">of {totalRows.toLocaleString()} total</p>
        </div>
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/60 px-3 py-2 text-sm shadow-sm backdrop-blur-sm">
          <p className="text-xs font-medium text-slate-600">Invalid / fees / debt TVT</p>
          <p className="mt-0.5 font-semibold tabular-nums text-slate-900">
            <span className="text-red-700">{agg.invalid.toLocaleString()}</span>
            <span className="text-slate-400"> · </span>
            <span className="text-amber-800">{agg.warnings.toLocaleString()}</span>
            <span className="text-slate-400"> · </span>
            <span className="text-rose-700">{(agg.debtRows ?? 0).toLocaleString()}</span>
          </p>
          <p className="mt-1 text-[11px] text-slate-500">Invalid · Acct. fee · Negative transfer</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="preview-search" className="mb-1 block text-xs font-medium text-slate-600">
            Search (row #, date, courier ID, phone, plate)
          </label>
          <input
            id="preview-search"
            type="search"
            disabled={!complete}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={complete ? "Filter loaded rows…" : "Loading…"}
            className="w-full rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-sm backdrop-blur-sm disabled:opacity-50"
          />
        </div>
        <div>
          <label htmlFor="preview-status" className="mb-1 block text-xs font-medium text-slate-600">
            Status
          </label>
          <select
            id="preview-status"
            disabled={!complete}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="w-full min-w-[10rem] rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-sm backdrop-blur-sm sm:w-auto disabled:opacity-50"
          >
            <option value="all">All rows</option>
            <option value="valid">Valid only</option>
            <option value="invalid">Invalid only</option>
            <option value="warnings">Acct. fee rows</option>
            <option value="debt_tvt">Negative TVT (debt)</option>
          </select>
        </div>
      </div>

      {loadError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600" />
          Loading preview… {loadedCount.toLocaleString()} / {totalRows.toLocaleString()} rows
        </div>
      )}

      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2.5 text-left text-sm font-medium text-slate-800 shadow-sm backdrop-blur-sm md:hidden"
        onClick={() => setMobileTableOpen((o) => !o)}
        aria-expanded={mobileTableOpen}
      >
        <span>Preview table ({complete ? filteredRows.length.toLocaleString() : "…"} rows)</span>
        <span className="text-slate-400" aria-hidden>
          {mobileTableOpen ? "▾" : "▸"}
        </span>
      </button>

      <div
        className={`overflow-x-auto rounded-xl border border-slate-200/80 bg-white/50 shadow-inner backdrop-blur-sm ${
          mobileTableOpen ? "block" : "hidden"
        } md:block`}
      >
        <div className={scrollShellClass}>
          <table className="min-w-[1080px] w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-20 border-b border-slate-200 bg-slate-50/95 text-slate-600 shadow-[0_1px_0_rgb(226_232_240)] backdrop-blur-sm">
              <tr>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">#</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Import</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Date</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Gross</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium" title="Tips / bacșiș">
                  Tips
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Net</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium" title="Total Venituri de transferat">
                  TVT
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Fee</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Cash</th>
                <th
                  className="whitespace-nowrap border-l border-amber-200 px-2 py-2.5 font-medium italic"
                  title="Taxa deschidere cont"
                >
                  Acct. fee
                </th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Id curier / hints</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Match</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium">Driver</th>
                <th className="whitespace-nowrap px-2 py-2.5 font-medium" title="Negative TVT = driver debt on commit">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-800">
              {!complete ? (
                <tr>
                  <td colSpan={14} className="px-3 py-12 text-center text-sm text-slate-500">
                    Preparing table…
                  </td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={14} className="px-3 py-12 text-center text-sm text-slate-500">
                    No rows match filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const ok = rowIsValidForCommit(r);
                  const debtRow = rowHasDebtSignal(r);
                  return (
                    <tr
                      key={r.rowIndex}
                      className={`hover:bg-slate-50/80 ${debtRow ? "bg-rose-50/50 ring-1 ring-inset ring-amber-300/60" : ""}`}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-600">{r.rowIndex + 1}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {ok ? (
                          <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-800">
                            Valid
                          </span>
                        ) : (
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">
                            Error
                          </span>
                        )}
                        {rowHasFeeWarning(r) && (
                          <span className="ml-1 inline-flex rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-medium text-amber-900">
                            Fee
                          </span>
                        )}
                        {debtRow && (
                          <span className="ml-1 inline-flex rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-semibold text-rose-900">
                            Debt TVT
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.tripDate ?? "—"}</td>
                      <td className={moneyCellClass(r.gross)}>{r.gross != null ? formatCurrency(r.gross) : "—"}</td>
                      <td className={moneyCellClass(r.tips)}>{r.tips != null ? formatCurrency(r.tips) : "—"}</td>
                      <td className={moneyCellClass(r.net)}>{r.net != null ? formatCurrency(r.net) : "—"}</td>
                      <td
                        className={`${moneyCellClass(r.transferTotal)} ${debtRow ? "shadow-[0_0_12px_rgba(251,113,133,0.35)]" : ""}`}
                      >
                        {r.transferTotal != null ? formatCurrency(r.transferTotal) : "—"}
                      </td>
                      <td className={moneyCellClass(r.platformFee)}>
                        {r.platformFee != null ? formatCurrency(r.platformFee) : "—"}
                      </td>
                      <td className={moneyCellClass(r.dailyCash)}>
                        {r.dailyCash != null ? formatCurrency(r.dailyCash) : "—"}
                      </td>
                      <td className="whitespace-nowrap border-l border-amber-100 px-2 py-1.5 italic text-slate-600">
                        {r.accountOpeningFee != null && r.accountOpeningFee > 0
                          ? `−${formatCurrency(r.accountOpeningFee)}`
                          : "—"}
                      </td>
                      <td className="max-w-[140px] truncate px-2 py-1.5 font-mono text-[11px] text-slate-600" title={r.hints?.courierId || r.hints?.phone || r.hints?.plate || ""}>
                        {r.hints?.courierId || r.hints?.phone || r.hints?.plate || "—"}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">
                        {MATCH_LABEL[r.matchMethod] ?? r.matchMethod}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {r.driverMatched ? (
                          <span className="font-medium text-emerald-700">Matched</span>
                        ) : (
                          <span className="text-slate-400">Unmatched</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {debtRow ? (
                          <span className="inline-flex rounded-full bg-gradient-to-r from-red-100 to-orange-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-900 ring-1 ring-orange-300/70">
                            DEBT
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-slate-500 italic">
        Native scroll (no virtualization). Rows with negative TVT are highlighted; they become driver debt on commit.
        Id curier / TVT / Taxa deschidere cont map to hints, transfer total, and account fee.
      </p>
    </div>
  );
}
