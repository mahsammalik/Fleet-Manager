import { useCallback, useEffect, useMemo, useState } from "react";
import type { CourierTableRow } from "../utils/courierTableParse";
import { parseCourierRawData } from "../utils/courierTableParse";
import {
  DEFAULT_BLACKBOX_CHAT_ID,
  readBlackboxMirror,
  syncCourierRowsToBlackbox,
} from "../lib/blackboxTableSync";

const STORAGE_KEY = (chatId: string) => `courier:table-data:${chatId}`;
const STORAGE_LINES_KEY = (chatId: string) => `courier:table-raw-lines:${chatId}`;

export interface UseTableDataOptions {
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

function loadStoredRows(chatId: string): CourierTableRow[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(chatId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CourierTableRow[]) : null;
  } catch {
    return null;
  }
}

export function useTableData(options: UseTableDataOptions = {}) {
  const chatId = options.chatId ?? DEFAULT_BLACKBOX_CHAT_ID;

  const [rawLines, setRawLinesState] = useState<string[]>(() => {
    const fromLs = loadStoredLines(chatId);
    if (fromLs?.length) return fromLs;
    return options.initialRawLines ?? [];
  });

  const [rows, setRows] = useState<CourierTableRow[]>(() => {
    const lines = loadStoredLines(chatId);
    if (lines?.length) return parseCourierRawData(lines).rows;
    if (options.initialRawLines?.length) return parseCourierRawData(options.initialRawLines).rows;
    return loadStoredRows(chatId) ?? readBlackboxMirror(chatId) ?? [];
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
        const fallback = loadStoredRows(chatId) ?? readBlackboxMirror(chatId);
        if (fallback?.length && !cancelled) setRows(fallback);
        if (!fallback?.length && !cancelled) setRows([]);
        setParseErrors([]);
        return;
      }

      const { rows: next, errors } = parseCourierRawData(rawLines);
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
            Fee: r.fee,
            Match: r.match,
            Driver: r.driver,
          })),
        );
      }

      try {
        localStorage.setItem(STORAGE_LINES_KEY(chatId), JSON.stringify(rawLines));
        localStorage.setItem(STORAGE_KEY(chatId), JSON.stringify(next));
        setPersistError(null);
      } catch (e) {
        setPersistError(e instanceof Error ? e.message : "localStorage failed");
      }

      const sync = await syncCourierRowsToBlackbox(chatId, next);
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
      localStorage.removeItem(STORAGE_KEY(chatId));
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
        Fee: r.fee,
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
