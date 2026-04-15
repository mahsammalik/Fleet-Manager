import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { DriverListItem } from "../api/drivers";
import { getDrivers, searchDrivers } from "../api/drivers";

const DEFAULT_DEBOUNCE_MS = 280;

export function useDriverCombobox(options?: { debounceMs?: number; queryEnabled?: boolean }) {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const queryEnabled = options?.queryEnabled !== false;

  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [debouncedInput, setDebouncedInput] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedInput(inputValue), debounceMs);
    return () => window.clearTimeout(id);
  }, [inputValue, debounceMs]);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["drivers", "combobox", debouncedInput],
    queryFn: async () => {
      const q = debouncedInput.trim();
      if (!q) {
        const { data: rows } = await getDrivers({ limit: 50 });
        return rows;
      }
      const { data: rows } = await searchDrivers(q, { limit: 100 });
      return rows;
    },
    enabled: queryEnabled && open,
    staleTime: 20_000,
  });

  const results = useMemo(() => data ?? [], [data]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [results]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const moveHighlight = useCallback(
    (delta: 1 | -1) => {
      if (results.length === 0) return;
      setHighlightedIndex((prev) => {
        if (prev < 0) return delta === 1 ? 0 : results.length - 1;
        const next = prev + delta;
        if (next < 0) return results.length - 1;
        if (next >= results.length) return 0;
        return next;
      });
    },
    [results.length],
  );

  const getHighlightedOrFirstDriver = useCallback((): DriverListItem | null => {
    if (results.length === 0) return null;
    if (highlightedIndex >= 0 && highlightedIndex < results.length) {
      return results[highlightedIndex] ?? null;
    }
    return results[0] ?? null;
  }, [highlightedIndex, results]);

  return {
    rootRef,
    open,
    setOpen,
    inputValue,
    setInputValue,
    debouncedInput,
    highlightedIndex,
    setHighlightedIndex,
    results,
    isFetching,
    isError,
    refetch,
    moveHighlight,
    getHighlightedOrFirstDriver,
  };
}
