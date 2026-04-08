import { useCallback, useEffect, useMemo, useState } from "react";
import type { DualCommissionCourierRow } from "../utils/courierTableParse";
import { parseCourierDualRawData } from "../utils/courierTableParse";
import {
  DEFAULT_BLACKBOX_CHAT_ID,
  readBlackboxMirrorDual,
  syncDualCommissionCourierRowsToBlackbox,
} from "../lib/blackboxTableSync";

const STORAGE_ROWS_KEY = (chatId: string) => `courier:dual-rows:${chatId}`;
const STORAGE_LINES_KEY = (chatId: string) => `courier:dual-lines:${chatId}`;

export interface UseDualCommissionTableOptions {
  /** Defaults to `dI1nCuH` (same as `DEFAULT_BLACKBOX_CHAT_ID`). */
  chatId?: string;
  initialRawLines?: string[];
}

function loadStoredLines(chatId: string): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_LINES_KEY(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) && parsed.every((x) => typeof x === "string") ? parsed : null;
  } catch {
    return null;
  }
}

function loadStoredRows(chatId: string): DualCommissionCourierRow[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_ROWS_KEY(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as DualCommissionCourierRow[]) : null;
  } catch {
    return null;
  }
}

export function useDualCommissionTable(options: UseDualCommissionTableOptions = {}) {
  const chatId = options.chatId ?? DEFAULT_BLACKBOX_CHAT_ID;

  const [rawLines, setRawLinesState] = useState<string[]>(() => {
    const fromLs = loadStoredLines(chatId);
    if (fromLs?.length) return fromLs;
    return options.initialRawLines ?? [];
  });

  const [rows, setRows] = useState<DualCommissionCourierRow[]>(() => {
    const lines = loadStoredLines(chatId);
    if (lines?.length) return parseCourierDualRawData(lines).rows;
    if (options.initialRawLines?.length) return parseCourierDualRawData(options.initialRawLines).rows;
    return loadStoredRows(chatId) ?? readBlackboxMirrorDual(chatId) ?? [];
  });

  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  const setRawLines = useCallback((lines: string[] | ((prev: string[]) => string[])) => {
    setRawLinesState((prev) => (typeof lines === "function" ? lines(prev) : lines));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (rawLines.length === 0) {
        const fallback = loadStoredRows(chatId) ?? readBlackboxMirrorDual(chatId);
        if (fallback?.length && !cancelled) setRows(fallback);
        if (!fallback?.length && !cancelled) setRows([]);
        setParseErrors([]);
        return;
      }

      const { rows: next, errors } = parseCourierDualRawData(rawLines);
      if (cancelled) return;
      setRows(next);
      setParseErrors(errors);

      if (import.meta.env.DEV && next.length) {
        console.table(
          next.map((r, i) => ({
            "#": i + 1,
            Date: r.date,
            Gross: r.gross,
            Net: r.net,
            Commission1: r.commission1,
            Commission2: r.commission2,
            TotalCommission: r.totalCommission,
            Match: r.match,
            Driver: r.driver,
          })),
        );
      }

      try {
        localStorage.setItem(STORAGE_LINES_KEY(chatId), JSON.stringify(rawLines));
        localStorage.setItem(STORAGE_ROWS_KEY(chatId), JSON.stringify(next));
        setPersistError(null);
      } catch (e) {
        setPersistError(e instanceof Error ? e.message : "localStorage failed");
      }

      const sync = await syncDualCommissionCourierRowsToBlackbox(chatId, next);
      if (!cancelled) setSyncError(sync.ok ? null : sync.error ?? "Sync failed");
    })();

    return () => {
      cancelled = true;
    };
  }, [rawLines, chatId]);

  const reloadFromStorage = useCallback(() => {
    const lines = loadStoredLines(chatId);
    if (lines?.length) {
      setRawLinesState(lines);
      return;
    }
    const storedRows = loadStoredRows(chatId);
    if (storedRows?.length) setRows(storedRows);
  }, [chatId]);

  const clearLocal = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_LINES_KEY(chatId));
      localStorage.removeItem(STORAGE_ROWS_KEY(chatId));
      setRawLinesState([]);
      setRows([]);
      setParseErrors([]);
      setPersistError(null);
      setSyncError(null);
    } catch {
      setPersistError("clear failed");
    }
  }, [chatId]);

  const tableDebug = useMemo(
    () =>
      rows.map((r, i) => ({
        "#": i + 1,
        Date: r.date,
        Gross: r.gross,
        Net: r.net,
        Commission1: r.commission1,
        Commission2: r.commission2,
        TotalCommission: r.totalCommission,
        Match: r.match,
        Driver: r.driver,
      })),
    [rows],
  );

  const logTable = useCallback(() => {
    console.table(tableDebug);
  }, [tableDebug]);

  return {
    chatId,
    rawLines,
    setRawLines,
    rows,
    parseErrors,
    persistError,
    syncError,
    reloadFromStorage,
    clearLocal,
    logTable,
  };
}
