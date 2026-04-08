import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useAuthStore } from "../../store/authStore";
import {
  previewEarningsImport,
  commitEarningsImport,
  cancelEarningsImport,
  type EarningsPreviewResponse,
} from "../../api/earningsImport";
import { getEarningsImports } from "../../api/earnings";
import { formatCurrency } from "../../utils/currency";

const PROVIDER_OPTIONS = [
  { value: "uber", label: "Uber" },
  { value: "bolt", label: "Bolt" },
  { value: "glovo", label: "Glovo Courier" },
  { value: "bolt_courier", label: "Bolt Courier" },
  { value: "wolt_courier", label: "Wolt Courier" },
] as const;

const MATCH_LABEL: Record<string, string> = {
  courier_id: "Courier ID",
  phone: "Phone",
  plate: "Plate",
  none: "No match",
};

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

  const [preview, setPreview] = useState<EarningsPreviewResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>("uber");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

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
      setPreview(res.data);
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
    onSuccess: () => {
      setPreview(null);
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
      setLocalError(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings", "imports"] });
    },
    onError: (e) => setLocalError(errMessage(e)),
  });

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (file) previewMut.mutate(file);
    },
    [previewMut],
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

  const busy = previewMut.isPending || commitMut.isPending || cancelMut.isPending;
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

      <div className="flex-1 p-4 sm:p-6 space-y-8 max-w-4xl mx-auto w-full">
        {localError && (
          <div className="rounded-xl bg-red-50 text-red-800 text-sm px-4 py-3 border border-red-100">{localError}</div>
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
                <span className="font-medium text-slate-900">{preview.totalRows}</span>
              </div>
              <div>
                <span className="text-slate-500">Match</span>{" "}
                <span className="font-medium text-sky-700">
                  {(preview.matchRate * 100).toFixed(1)}%
                </span>
              </div>
            </div>

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

            <div className="overflow-x-auto -mx-2">
              <p className="text-xs font-semibold text-slate-700 mb-2 px-2">Preview (first 10 rows)</p>
              <table className="min-w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-2 font-medium">Date</th>
                    <th className="py-2 pr-2 font-medium">Gross</th>
                    <th className="py-2 pr-2 font-medium">Net</th>
                    <th className="py-2 pr-2 font-medium">TVT</th>
                    <th className="py-2 pr-2 font-medium">Fee</th>
                    <th className="py-2 pr-2 font-medium">Cash</th>
                    <th className="py-2 pr-2 font-medium border-l-2 border-amber-200">Acct. fee</th>
                    <th className="py-2 pr-2 font-medium">Match</th>
                    <th className="py-2 pr-2 font-medium">Driver</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.previewRows.map((r) => (
                    <tr key={r.rowIndex} className="border-b border-slate-100">
                      <td className="py-1.5 pr-2 text-slate-600">{r.rowIndex + 1}</td>
                      <td className="py-1.5 pr-2">{r.tripDate ?? "—"}</td>
                      <td className="py-1.5 pr-2">{r.gross != null ? formatCurrency(r.gross) : "—"}</td>
                      <td className="py-1.5 pr-2">{r.net != null ? formatCurrency(r.net) : "—"}</td>
                      <td className="py-1.5 pr-2">{r.transferTotal != null ? formatCurrency(r.transferTotal) : "—"}</td>
                      <td className="py-1.5 pr-2">{r.platformFee != null ? formatCurrency(r.platformFee) : "—"}</td>
                      <td className="py-1.5 pr-2">{r.dailyCash != null ? formatCurrency(r.dailyCash) : "—"}</td>
                      <td className="py-1.5 pr-2 border-l-2 border-amber-100 italic text-slate-600">
                        {r.accountOpeningFee != null && r.accountOpeningFee > 0
                          ? `−${formatCurrency(r.accountOpeningFee)}`
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-2 text-slate-600">{MATCH_LABEL[r.matchMethod] ?? r.matchMethod}</td>
                      <td className="py-1.5 pr-2">
                        {r.driverMatched ? (
                          <span className="text-emerald-700 font-medium">Matched</span>
                        ) : (
                          <span className="text-slate-400">Unmatched</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                {commitMut.isPending ? "Importing…" : "Confirm import"}
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
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Recent imports</h2>
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
