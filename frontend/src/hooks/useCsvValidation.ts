import { useMemo, useState, useCallback } from "react";
import Papa from "papaparse";
import type { EarningsPreviewResponse } from "../api/earningsImport";
import { parseRoNumberCell } from "../utils/courierTableParse";

/** Match backend `romanHeaderMap.normalizeHeaderKey` for client-side TVT scan. */
export function normalizeEarningsHeaderKey(raw: string): string {
  return String(raw ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function parseRoNumberClient(s: string): number | null {
  return parseRoNumberCell(String(s ?? ""));
}

/** Column index for Total Venituri de transferat (TVT) style headers. */
export function findTransferTotalColumnIndex(headers: string[]): number {
  const norm = headers.map((h) => normalizeEarningsHeaderKey(String(h)));
  const byAlias = norm.findIndex((k) => {
    if (!k) return false;
    if (k.includes("venituri") && (k.includes("transferat") || k.includes("transfera"))) return true;
    if (k === "total venituri de transferat" || k === "total venituri de transfera") return true;
    return false;
  });
  if (byAlias >= 0) return byAlias;
  return norm.findIndex((k) => k.includes("tvt") || k.includes("transfer total"));
}

export type CsvDebtScanResult = {
  /** Rows (excluding header) with TVT less than 0 in the detected TVT column. */
  negativeTvtRowCount: number;
  /** Whether a TVT-like column was found. */
  tvtColumnFound: boolean;
};

/**
 * Quick client scan before / alongside server preview — same sign semantics as Excel for TVT.
 */
export function scanCsvForNegativeTransferTotals(file: File): Promise<CsvDebtScanResult> {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return Promise.resolve({ negativeTvtRowCount: 0, tvtColumnFound: false });
  }

  return new Promise((resolve) => {
    Papa.parse<string[]>(file, {
      header: false,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const rows = results.data;
        if (!Array.isArray(rows) || rows.length < 2) {
          resolve({ negativeTvtRowCount: 0, tvtColumnFound: false });
          return;
        }
        const headerRow = rows[0]?.map((c) => String(c ?? "").trim().replace(/^\ufeff/, "")) ?? [];
        const tvtIdx = findTransferTotalColumnIndex(headerRow);
        if (tvtIdx < 0) {
          resolve({ negativeTvtRowCount: 0, tvtColumnFound: false });
          return;
        }
        let negativeTvtRowCount = 0;
        for (let i = 1; i < rows.length; i++) {
          const line = rows[i];
          if (!Array.isArray(line)) continue;
          const raw = String(line[tvtIdx] ?? "").trim();
          if (!raw) continue;
          const v = parseRoNumberClient(raw);
          if (v != null && v < 0) negativeTvtRowCount += 1;
        }
        resolve({ negativeTvtRowCount, tvtColumnFound: true });
      },
      error: () => resolve({ negativeTvtRowCount: 0, tvtColumnFound: false }),
    });
  });
}

export type UseCsvValidationResult = {
  /** Fast CSV scan (optional). */
  clientDebtScan: CsvDebtScanResult | null;
  setClientDebtScan: (v: CsvDebtScanResult | null) => void;
  /** From server preview aggregates after `/import/preview`. */
  previewDebtRows: number;
  /** Single line for summary banner. */
  debtSummaryLine: string | null;
  runClientDebtScan: (file: File) => Promise<void>;
};

/**
 * Debt / negative TVT signals for earnings import: optional client CSV scan + server preview counts.
 */
export function useCsvValidation(preview: EarningsPreviewResponse | null): UseCsvValidationResult {
  const [clientDebtScan, setClientDebtScan] = useState<CsvDebtScanResult | null>(null);

  const previewDebtRows = preview?.aggregates?.debtRows ?? 0;

  const debtSummaryLine = useMemo(() => {
    const parts: string[] = [];
    if (clientDebtScan?.tvtColumnFound && clientDebtScan.negativeTvtRowCount > 0) {
      parts.push(
        `${clientDebtScan.negativeTvtRowCount} row${clientDebtScan.negativeTvtRowCount === 1 ? "" : "s"} with negative TVT (quick CSV scan)`,
      );
    }
    if (previewDebtRows > 0) {
      parts.push(
        `${previewDebtRows} debt record${previewDebtRows === 1 ? "" : "s"} detected in preview`,
      );
    }
    if (!parts.length) return null;
    return parts.join(" · ");
  }, [clientDebtScan, previewDebtRows]);

  const runClientDebtScan = useCallback(async (file: File) => {
    const r = await scanCsvForNegativeTransferTotals(file);
    setClientDebtScan(r);
  }, []);

  return {
    clientDebtScan,
    setClientDebtScan,
    previewDebtRows,
    debtSummaryLine,
    runClientDebtScan,
  };
}
