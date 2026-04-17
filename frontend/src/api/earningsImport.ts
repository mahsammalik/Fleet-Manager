import { useAuthStore } from "../store/authStore";
import { api, apiBaseURL } from "../lib/api";

export interface EarningsPreviewRow {
  rowIndex: number;
  tripDate: string | null;
  gross: number | null;
  net: number | null;
  /** Total Venituri de transferat (TVT) when column mapped */
  transferTotal: number | null;
  platformFee: number | null;
  dailyCash: number | null;
  /** Positive magnitude from CSV (e.g. -71.44); tracking only */
  accountOpeningFee: number | null;
  tripCount: number | null;
  matchMethod: string;
  driverMatched: boolean;
  hints: {
    courierId?: string;
    phone?: string;
    plate?: string;
  };
  /** From server preview mapper; client may infer from transferTotal when absent. */
  negativeTransferTotal?: boolean;
}

export interface EarningsPreviewAggregates {
  /** Rows that will be inserted (matched driver, date, and money present). */
  valid: number;
  /** Rows skipped on commit (missing driver, date, or money). */
  invalid: number;
  /** Rows with account-opening fee present (informational). */
  warnings: number;
  /** Rows with negative TVT (transfer total) — recorded as driver debt on commit. */
  debtRows?: number;
}

export interface EarningsPreviewResponse {
  importId: string;
  platform: string;
  /** 0–1 share of detection score for the chosen platform */
  detectionConfidence?: number;
  fileName: string;
  totalRows: number;
  matchedPreviewCount: number;
  matchRate: number;
  weekStart: string;
  weekEnd: string;
  warnings: string[];
  /** Empty after server change; use GET preview-rows for data. */
  previewRows: EarningsPreviewRow[];
  aggregates?: EarningsPreviewAggregates;
}

export type EarningsPreviewRowsPage = {
  offset: number;
  limit: number;
  total: number;
  rows: EarningsPreviewRow[];
};

export interface EarningsCommitResponse {
  importId: string;
  insertedRows: number;
  skippedNoDriver: number;
  skippedNoDate: number;
  skippedNoMoney: number;
  autoMatchedVehicleRentals?: number;
  totals: {
    gross: number;
    fee: number;
    net: number;
    comm: number;
    payout: number;
    trips: number;
  };
}

export function previewEarningsImport(file: File) {
  const fd = new FormData();
  fd.append("file", file);
  return api.post<EarningsPreviewResponse>("/earnings/import/preview", fd);
}

export function fetchEarningsPreviewRows(importId: string, offset: number, limit: number) {
  return api.get<EarningsPreviewRowsPage>(`/earnings/import/${importId}/preview-rows`, {
    params: { offset, limit },
  });
}

export type EarningsCommitOptions = {
  platform?: string;
  weekStart?: string;
  weekEnd?: string;
};

export function commitEarningsImport(importId: string, opts?: EarningsCommitOptions) {
  return api.post<EarningsCommitResponse>("/earnings/import/commit", {
    importId,
    ...opts,
  });
}

export function cancelEarningsImport(importId: string) {
  return api.delete(`/earnings/import/${importId}`);
}

/**
 * Best-effort cancel when the tab is closing or navigating away without a full axios round-trip
 * (e.g. `beforeunload` / `pagehide`). Uses `fetch` + `keepalive` so the DELETE may complete after unload.
 * Reuses the same DELETE endpoint as {@link cancelEarningsImport}.
 */
export function cancelStagedImportKeepalive(importId: string): void {
  const id = String(importId ?? "").trim();
  if (!id) return;
  const token = useAuthStore.getState().token;
  if (!token) return;
  const base = String(apiBaseURL).replace(/\/$/, "");
  try {
    void fetch(`${base}/earnings/import/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      keepalive: true,
    });
  } catch {
    /* ignore */
  }
}
