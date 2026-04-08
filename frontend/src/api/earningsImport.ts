import { api } from "../lib/api";

export interface EarningsPreviewRow {
  rowIndex: number;
  tripDate: string | null;
  gross: number | null;
  net: number | null;
  /** Total Venituri de transferat (TVT) when column mapped */
  transferTotal: number | null;
  platformFee: number | null;
  dailyCash: number | null;
  tripCount: number | null;
  matchMethod: string;
  driverMatched: boolean;
  hints: {
    courierId?: string;
    phone?: string;
    plate?: string;
  };
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
  previewRows: EarningsPreviewRow[];
}

export interface EarningsCommitResponse {
  importId: string;
  insertedRows: number;
  skippedNoDriver: number;
  skippedNoDate: number;
  skippedNoMoney: number;
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
  return api.post<EarningsPreviewResponse>("/dashboard/earnings/import/preview", fd);
}

export type EarningsCommitOptions = {
  platform?: string;
  weekStart?: string;
  weekEnd?: string;
};

export function commitEarningsImport(importId: string, opts?: EarningsCommitOptions) {
  return api.post<EarningsCommitResponse>("/dashboard/earnings/import/commit", {
    importId,
    ...opts,
  });
}

export function cancelEarningsImport(importId: string) {
  return api.delete(`/dashboard/earnings/import/${importId}`);
}
