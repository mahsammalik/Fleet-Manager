import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Papa from "papaparse";
import { useAuthStore } from "../../store/authStore";
import {
  previewEarningsImport,
  commitEarningsImport,
  cancelEarningsImport,
  type EarningsPreviewResponse,
  type EarningsCommitResponse,
} from "../../api/earningsImport";
import { syncEarningsVehicleRentals } from "../../api/earnings";
import { getEarningsImports } from "../../api/earnings";
import { EarningsImportPreviewVirtualTable } from "../../components/earnings/EarningsImportPreviewVirtualTable";
import { useCsvValidation } from "../../hooks/useCsvValidation";

const PROVIDER_OPTIONS = [
  { value: "uber", label: "Uber" },
  { value: "bolt", label: "Bolt" },
  { value: "glovo", label: "Glovo Courier" },
  { value: "bolt_courier", label: "Bolt Courier" },
  { value: "wolt_courier", label: "Wolt Courier" },
] as const;

function providerLabel(value: string): string {
  return PROVIDER_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function localIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function weeklyDefaultRange(): { start: string; end: string } {
  const ref = new Date();
  const end = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(end.getDate() - 7);
  return { start: localIsoDate(start), end: localIsoDate(end) };
}

function errMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const m = e.response?.data as { message?: string } | undefined;
    if (m?.message) return m.message;
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

export function EarningsImportPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importSuccess, setImportSuccess] = useState<EarningsCommitResponse | null>(null);

  const [preview, setPreview] = useState<EarningsPreviewResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [clientCsvRowCount, setClientCsvRowCount] = useState<number | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>("uber");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  const { setClientDebtScan, runClientDebtScan, debtSummaryLine } = useCsvValidation(preview);

  useEffect(() => {
    const { start, end } = weeklyDefaultRange();
    setPeriodStart(start);
    setPeriodEnd(end);
  }, []);

  useEffect(() => {
    if (preview) setSelectedPlatform(preview.platform);
  }, [preview?.importId]);

  const importsQuery = useQuery({
    queryKey: ["earnings", "imports"],
    queryFn: () => getEarningsImports(1, 15).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  const previewMut = useMutation({
    mutationFn: (file: File) => previewEarningsImport(file),
    onSuccess: (res) => {
      setLocalError(null);
      setImportSuccess(null);
      setPreview(res.data);
      setClientCsvRowCount(null);
    },
    onError: (e) => {
      setPreview(null);
      setLocalError(errMessage(e));
    },
  });

  const commitMut = useMutation({
    mutationFn: (args: { importId: string; platform: string; weekStart: string; weekEnd: string }) =>
      commitEarningsImport(args.importId, {
        platform: args.platform,
        weekStart: args.weekStart,
        weekEnd: args.weekEnd,
      }),
    onSuccess: (res) => {
      setImportSuccess(res.data);
      setPreview(null);
      setClientDebtScan(null);
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (e) => setLocalError(errMessage(e)),
  });

  const syncMut = useMutation({
    mutationFn: () => syncEarningsVehicleRentals(),
    onSuccess: () => {
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (e) => setLocalError(errMessage(e)),
  });

  const cancelMut = useMutation({
    mutationFn: (importId: string) => cancelEarningsImport(importId),
    onSuccess: () => {
      setPreview(null);
      setClientDebtScan(null);
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings", "imports"] });
    },
    onError: (e) => setLocalError(errMessage(e)),
  });

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setClientCsvRowCount(null);
      setClientDebtScan(null);
      if (file.name.toLowerCase().endsWith(".csv")) {
        void runClientDebtScan(file);
        Papa.parse<Record<string, unknown>>(file, {
          header: true,
          skipEmptyLines: "greedy",
          complete: (results) => {
            const n = Array.isArray(results.data) ? results.data.length : 0;
            setClientCsvRowCount(n);
          },
          error: () => setClientCsvRowCount(null),
        });
      }
      previewMut.mutate(file);
    },
    [previewMut, setClientDebtScan, runClientDebtScan],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragActive(false);
      const f = e.dataTransfer.files?.[0];
      handleFile(f);
    },
    [handleFile],
  );

  const busy = previewMut.isPending || commitMut.isPending || cancelMut.isPending || syncMut.isPending;
  const confidencePct =
    preview?.detectionConfidence != null ? Math.round(preview.detectionConfidence * 100) : null;
  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && PROVIDER_OPTIONS.some((o) => o.value === selectedPlatform));

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access to earnings import.</p>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Import earnings</h1>
        <p className="text-sm text-slate-500 mt-1">
          Drag a file onto the zone or browse. CSV, XLSX, ZIP, XML, or PDF.
        </p>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-8 max-w-6xl mx-auto w-full">
        {localError && (
          <div className="rounded-xl bg-red-50 text-red-800 text-sm px-4 py-3 border border-red-100">{localError}</div>
        )}

        {importSuccess && (
          <div className="rounded-2xl border border-emerald-200/80 bg-emerald-50/70 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.06)] px-4 py-3 text-sm text-emerald-900">
            <p className="font-medium">Import complete</p>
            <p className="mt-1 text-emerald-800/90">
              {importSuccess.insertedRows} row(s) saved.
              {typeof importSuccess.autoMatchedVehicleRentals === "number" && (
                <>
                  {" "}
                  Auto-matched {importSuccess.autoMatchedVehicleRentals} vehicle rental
                  {importSuccess.autoMatchedVehicleRentals === 1 ? "" : "s"}.
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-emerald-900/80">
              Matched rows use the full vehicle rental contract amount (total_rent_amount), not a daily split. Payouts sum each
              rental once per period.
            </p>
          </div>
        )}

        {!preview && (
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
            className={`
              rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors cursor-pointer
              ${dragActive ? "border-sky-500 bg-sky-50/80" : "border-slate-300 bg-white/60 hover:border-slate-400"}
              shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-sm
            `}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls,.zip,.xml,.pdf"
              className="hidden"
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = "";
                handleFile(f);
              }}
            />
            <p className="text-slate-700 font-medium">Drop file here or click to browse</p>
            <p className="text-xs text-slate-500 mt-2">Max size per server limits (earnings uploads)</p>
            {previewMut.isPending && (
              <div className="mt-4 max-w-xs mx-auto">
                <div className="h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full w-1/2 bg-sky-500 rounded-full animate-pulse" style={{ width: "40%" }} />
                </div>
                <p className="text-xs text-slate-500 mt-2">Parsing…</p>
              </div>
            )}
          </div>
        )}

        {preview && (
          <div className="rounded-2xl border border-white/30 bg-white/70 backdrop-blur-md shadow-lg p-4 sm:p-6 space-y-4">
            <div className="text-sm text-slate-700">
              <span className="text-slate-500">Detected:</span>{" "}
              <span className="font-medium text-slate-900">
                {providerLabel(preview.platform)}
                {confidencePct != null ? ` (${confidencePct}%)` : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="import-provider" className="block text-xs font-medium text-slate-700 mb-1">
                  Provider
                </label>
                <select
                  id="import-provider"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  value={selectedPlatform}
                  disabled={busy}
                  onChange={(e) => setSelectedPlatform(e.target.value)}
                >
                  {PROVIDER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="import-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Period start
                  </label>
                  <input
                    id="import-start"
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                    value={periodStart}
                    disabled={busy}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="import-end" className="block text-xs font-medium text-slate-700 mb-1">
                    Period end
                  </label>
                  <input
                    id="import-end"
                    type="date"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                    value={periodEnd}
                    disabled={busy}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <div>
                <span className="text-slate-500">File</span>{" "}
                <span className="font-medium text-slate-900">{preview.fileName}</span>
              </div>
              <div>
                <span className="text-slate-500">Rows</span>{" "}
                <span className="font-medium text-slate-900">{preview.totalRows.toLocaleString()}</span>
                {clientCsvRowCount != null && (
                  <span className="block text-[11px] font-normal text-slate-500 mt-0.5">
                    CSV scan: ~{clientCsvRowCount.toLocaleString()} data rows (Papa Parse)
                  </span>
                )}
              </div>
              <div>
                <span className="text-slate-500">Match</span>{" "}
                <span className="font-medium text-sky-700">
                  {(preview.matchRate * 100).toFixed(1)}%
                </span>
              </div>
            </div>

            {debtSummaryLine && (
              <div className="rounded-xl border border-rose-200 bg-rose-50/95 px-3 py-2.5 text-sm text-rose-950 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">Debt detection</p>
                <p className="mt-1 text-sm font-medium text-rose-900">{debtSummaryLine}</p>
                <p className="mt-1 text-[11px] text-rose-800/90">
                  Preview shows the same signs as your file. Negative TVT rows become driver debt on import.
                </p>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-3 py-2">
                <p className="text-xs font-semibold text-amber-900 mb-1">Data quality</p>
                <ul className="text-xs text-amber-900 list-disc list-inside space-y-0.5">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-xs font-semibold text-slate-700 mb-2">
                Full data preview ({preview.totalRows.toLocaleString()} rows)
              </p>
              <EarningsImportPreviewVirtualTable
                importId={preview.importId}
                totalRows={preview.totalRows}
                aggregates={preview.aggregates}
                matchedPreviewCount={preview.matchedPreviewCount}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy || !periodValid}
                onClick={() =>
                  commitMut.mutate({
                    importId: preview.importId,
                    platform: selectedPlatform,
                    weekStart: periodStart,
                    weekEnd: periodEnd,
                  })
                }
                className="rounded-lg bg-sky-600 text-white text-sm font-medium px-4 py-2.5 min-h-[44px] hover:bg-sky-700 disabled:opacity-50"
              >
                {commitMut.isPending ? "Importing…" : "Confirm import (valid rows only)"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => cancelMut.mutate(preview.importId)}
                className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2.5 min-h-[44px] hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel preview
              </button>
            </div>
          </div>
        )}

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Recent imports</h2>
            <button
              type="button"
              disabled={busy}
              onClick={() => syncMut.mutate()}
              className="rounded-lg border border-slate-300 bg-white/80 text-slate-700 text-xs font-medium px-3 py-2 min-h-[36px] hover:bg-slate-50 disabled:opacity-50"
            >
              {syncMut.isPending ? "Re-syncing…" : "Re-sync vehicle rentals"}
            </button>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/60 backdrop-blur-sm shadow-sm">
            {importsQuery.isLoading ? (
              <p className="p-4 text-sm text-slate-500">Loading…</p>
            ) : (
              <table className="min-w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-3 py-2">File</th>
                    <th className="px-3 py-2">Platform</th>
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Rows</th>
                    <th className="px-3 py-2">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(importsQuery.data?.items ?? []).map((row) => (
                    <tr key={row.id} className="text-slate-800">
                      <td className="px-3 py-2 max-w-[180px] truncate">{row.file_name ?? "—"}</td>
                      <td className="px-3 py-2">{row.platform}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-xs">
                        {row.week_start?.slice(0, 10)} – {row.week_end?.slice(0, 10)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            row.status === "completed"
                              ? "bg-emerald-100 text-emerald-800"
                              : row.status === "preview"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.record_count ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                        {row.created_at?.slice(0, 19).replace("T", " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
