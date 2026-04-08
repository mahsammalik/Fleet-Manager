import { useMemo, useState } from "react";
import { useDualCommissionTable } from "../../hooks/useDualCommissionTable";

/** Example 7-column raw line (after CSV merge): commissions as labeled cells. */
export const EXAMPLE_DUAL_COMMISSION_RAW_DATA = [
  "—,2.432,30 RON,2.512,63 RON,Total Venituri de transferat: 50 RON,Plata zilnica cu cash: 30 RON,Courier ID,Matched",
  "Ajustari Totale: 80.333755,ignore,this,row",
  "2024-01-02,1.200 RON,1.250 RON,Total Venituri de transferat: 10 RON,Plata zilnica cu cash: 5 RON,Courier2,Matched",
];

export interface DualCommissionCourierTableProps {
  chatId?: string;
  initialRawLines?: string[];
}

export function DualCommissionCourierTable({
  chatId,
  initialRawLines = EXAMPLE_DUAL_COMMISSION_RAW_DATA,
}: DualCommissionCourierTableProps) {
  const {
    rows,
    rawLines,
    setRawLines,
    parseErrors,
    persistError,
    syncError,
    reloadFromStorage,
    clearLocal,
    logTable,
  } = useDualCommissionTable({ chatId, initialRawLines });

  const [pasteText, setPasteText] = useState("");

  const lineCount = useMemo(() => rawLines.filter((l) => l.trim()).length, [rawLines]);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Dual commission courier table</h2>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-200"
            onClick={logTable}
          >
            console.table
          </button>
          <button
            type="button"
            className="rounded-lg bg-sky-100 px-3 py-1.5 text-sm text-sky-800 hover:bg-sky-200"
            onClick={reloadFromStorage}
          >
            Reload from storage
          </button>
          <button
            type="button"
            className="rounded-lg bg-red-50 px-3 py-1.5 text-sm text-red-700 hover:bg-red-100"
            onClick={clearLocal}
          >
            Clear local
          </button>
        </div>
      </div>

      <label className="block text-sm text-slate-600">
        Paste CSV lines (one row per line)
        <textarea
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
          rows={4}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="—,2.432,30 RON,…,Total Venituri de transferat: 50 RON,Plata zilnica cu cash: 30 RON,…"
        />
      </label>
      <button
        type="button"
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        onClick={() => setRawLines(pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))}
      >
        Apply pasted lines (
        {pasteText ? pasteText.split(/\r?\n/).filter((l) => l.trim()).length : 0})
      </button>

      {(parseErrors.length > 0 || persistError || syncError) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {persistError && <p>Storage: {persistError}</p>}
          {syncError && <p>Sync: {syncError}</p>}
          {parseErrors.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Parsed rows: {rows.length} (raw lines with content: {lineCount}). “Ajustari Totale” rows are skipped. Keys:{" "}
        <code className="rounded bg-slate-100 px-1">courier:dual-lines:</code> /{" "}
        <code className="rounded bg-slate-100 px-1">courier:dual-rows:</code> per chatId; mirror{" "}
        <code className="rounded bg-slate-100 px-1">blackbox:table-mirror:dual:</code>.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Gross</th>
              <th className="px-3 py-2">Net</th>
              <th className="px-3 py-2">Commission1</th>
              <th className="px-3 py-2">Commission2</th>
              <th className="px-3 py-2">TotalCommission</th>
              <th className="px-3 py-2">Match</th>
              <th className="px-3 py-2">Driver</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.date}-${r.driver}-${i}`} className="border-t border-slate-100">
                <td className="px-3 py-2 text-slate-500">{i + 1}</td>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2">{r.gross}</td>
                <td className="px-3 py-2">{r.net}</td>
                <td className="px-3 py-2">{r.commission1}</td>
                <td className="px-3 py-2">{r.commission2}</td>
                <td className="px-3 py-2">{r.totalCommission}</td>
                <td className="px-3 py-2">{r.match}</td>
                <td className="px-3 py-2">{r.driver}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
