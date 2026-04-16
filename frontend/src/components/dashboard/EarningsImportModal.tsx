import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { useAuthStore } from "../../store/authStore";
import {
  previewEarningsImport,
  commitEarningsImport,
  cancelEarningsImport,
  type EarningsPreviewResponse,
} from "../../api/earningsImport";
import { EarningsImportPreviewVirtualTable } from "../earnings/EarningsImportPreviewVirtualTable";

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

/** Rolling window: local yesterday minus 7 calendar days through local yesterday. */
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

export type EarningsImportModalProps = {
  open: boolean;
  onClose: () => void;
};

export function EarningsImportModal({ open, onClose }: EarningsImportModalProps) {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const canImport = user?.role === "admin" || user?.role === "accountant";

  const [preview, setPreview] = useState<EarningsPreviewResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState<string>("uber");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setLocalError(null);
      return;
    }
    const { start, end } = weeklyDefaultRange();
    setPeriodStart(start);
    setPeriodEnd(end);
  }, [open]);

  useEffect(() => {
    if (preview) {
      setSelectedPlatform(preview.platform);
    }
  }, [preview?.importId]);

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
      onClose();
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
    },
    onError: (e) => setLocalError(errMessage(e)),
  });

  if (!open || !canImport) {
    return null;
  }

  const busy = previewMut.isPending || commitMut.isPending || cancelMut.isPending;
  const confidencePct =
    preview?.detectionConfidence != null ? Math.round(preview.detectionConfidence * 100) : null;
  const periodValid =
    Boolean(periodStart && periodEnd && periodStart <= periodEnd && PROVIDER_OPTIONS.some((o) => o.value === selectedPlatform));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-5xl max-h-[90vh] overflow-y-auto my-8">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold text-slate-900">Import earnings</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (preview?.importId) {
                void cancelMut.mutateAsync(preview.importId).finally(() => onClose());
              } else {
                onClose();
              }
            }}
            className="text-slate-400 hover:text-slate-600 text-sm disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <p className="text-xs text-slate-600 mb-4">
          Upload platform reports: CSV, XLSX, ZIP, XML, or PDF. After preview, adjust provider and pay period if
          needed, then confirm import.
        </p>

        {!preview && (
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <label className="inline-flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
              <span className="rounded-lg border border-slate-300 px-3 py-1.5 bg-slate-50 hover:bg-slate-100">
                Choose file
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls,.zip,.xml,.pdf"
                className="hidden"
                disabled={busy}
                onChange={(ev) => {
                  const f = ev.target.files?.[0];
                  ev.target.value = "";
                  if (f) previewMut.mutate(f);
                }}
              />
            </label>
            {previewMut.isPending && (
              <span className="text-sm text-slate-500 flex items-center gap-2">
                <span className="inline-block h-4 w-4 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
                Parsing file…
              </span>
            )}
          </div>
        )}

        {localError && (
          <div className="mb-3 rounded-lg bg-red-50 text-red-800 text-sm px-3 py-2">{localError}</div>
        )}

        {preview && (
          <div className="space-y-4 border-t border-slate-100 pt-4">
            <div className="text-sm text-slate-700">
              <span className="text-slate-500">Detected:</span>{" "}
              <span className="font-medium text-slate-900">
                {providerLabel(preview.platform)}
                {confidencePct != null ? ` (${confidencePct}%)` : ""}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="earnings-provider" className="block text-xs font-medium text-slate-700 mb-1">
                  Provider
                </label>
                <select
                  id="earnings-provider"
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                  <label htmlFor="earnings-period-start" className="block text-xs font-medium text-slate-700 mb-1">
                    Period start
                  </label>
                  <input
                    id="earnings-period-start"
                    type="date"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={periodStart}
                    disabled={busy}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="earnings-period-end" className="block text-xs font-medium text-slate-700 mb-1">
                    Period end
                  </label>
                  <input
                    id="earnings-period-end"
                    type="date"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
              </div>
              <div>
                <span className="text-slate-500">Driver match rate</span>{" "}
                <span className="font-medium text-sky-700">
                  {(preview.matchRate * 100).toFixed(1)}% ({preview.matchedPreviewCount} / {preview.totalRows})
                </span>
              </div>
            </div>

            {preview.warnings.length > 0 && (
              <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
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
                className="rounded-lg bg-sky-600 text-white text-sm font-medium px-4 py-2 hover:bg-sky-700 disabled:opacity-50"
              >
                {commitMut.isPending ? "Importing…" : "Confirm import (valid rows only)"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => cancelMut.mutate(preview.importId)}
                className="rounded-lg border border-slate-300 text-slate-700 text-sm font-medium px-4 py-2 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Rows without a date in the file use the period end as trip date. Only rows with a matched driver and a
              gross, net, or TVT amount are written. Transfer commission uses TVT when the column is present, otherwise
              net; cash commission uses daily cash when present. Totals roll into pending driver payments for the period
              above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
