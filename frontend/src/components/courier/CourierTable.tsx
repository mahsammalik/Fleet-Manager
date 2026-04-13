import { useMemo, useState } from "react";
import { useTableData } from "../../hooks/useTableData";

/** Example lines matching your raw courier export format. */
export const EXAMPLE_COURIER_RAW_DATA = [
  "—,2.432,30 RON,2.512,63 RON,Plata zilnica cu cash,Courier ID,Matched",
  "Ajustari Totale: 80.333755,ignore,this,row",
  "2024-01-02,1.200 RON,1.250 RON,500 RON,Courier2,Matched",
];

export interface CourierTableProps {
  chatId?: string;
  initialRawLines?: string[];
}

export function CourierTable({ chatId, initialRawLines = EXAMPLE_COURIER_RAW_DATA }: CourierTableProps) {
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
  } = useTableData({ chatId, initialRawLines });

  const [pasteText, setPasteText] = useState("");

  const lineCount = useMemo(() => rawLines.filter((l) => l.trim()).length, [rawLines]);

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-slate-800">Courier table</h2>
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
          placeholder="—,2.432,30 RON,2.512,63 RON,Plata zilnica cu cash,..."
        />
      </label>
      <button
        type="button"
        className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700"
        onClick={() =>
          setRawLines(pasteText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))
        }
      >
        Apply pasted lines ({pasteText ? pasteText.split(/\r?\n/).filter((l) => l.trim()).length : 0})
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
        Parsed rows: {rows.length} (raw lines with content: {lineCount}). Rows with &quot;Ajustari Totale&quot; are
        skipped. Set <code className="rounded bg-slate-100 px-1">VITE_BLACKBOX_TABLE_SYNC_URL</code> for remote
        sync; mirror key uses chatId.
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Date</th>
              <th className="px-3 py-2">Gross</th>
              <th className="px-3 py-2">Net</th>
              <th className="px-3 py-2">Fee</th>
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
                <td className="px-3 py-2">{r.fee}</td>
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
