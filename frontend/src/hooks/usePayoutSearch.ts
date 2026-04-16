import { useEffect, useMemo, useState } from "react";
import type { PayoutListItem } from "../api/earnings";

const DEFAULT_DEBOUNCE_MS = 300;

function payoutPeriodLabel(row: PayoutListItem): string {
  const start = row.payment_period_start?.slice(0, 10) ?? "";
  const end = row.payment_period_end?.slice(0, 10) ?? "";
  return `${start} ${end}`.trim();
}

function payoutVehicleRentalLabel(row: PayoutListItem): string {
  return row.vehicle_rental_fee != null ? String(row.vehicle_rental_fee) : "";
}

function payoutMatchesQuery(row: PayoutListItem, query: string, statusFilter: string): boolean {
  const q = query.trim().toLowerCase();
  if (statusFilter && row.payment_status !== statusFilter) return false;
  if (!q) return true;

  const fullName = `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim();
  const haystacks = [
    fullName,
    row.first_name ?? "",
    row.last_name ?? "",
    row.phone ?? "",
    row.platform_id ?? "",
    row.payment_status ?? "",
    payoutPeriodLabel(row),
    payoutVehicleRentalLabel(row),
  ];
  return haystacks.some((v) => String(v).toLowerCase().includes(q));
}

export function usePayoutSearch(rows: PayoutListItem[] | undefined, debounceMs: number = DEFAULT_DEBOUNCE_MS) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery), debounceMs);
    return () => window.clearTimeout(id);
  }, [searchQuery, debounceMs]);

  const filteredRows = useMemo(() => {
    if (!rows?.length) return [];
    return rows.filter((row) => payoutMatchesQuery(row, debouncedQuery, statusFilter));
  }, [rows, debouncedQuery, statusFilter]);

  const totalCount = rows?.length ?? 0;
  const filteredCount = filteredRows.length;
  const isFilterPending = searchQuery !== debouncedQuery;

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    statusFilter,
    setStatusFilter,
    filteredRows,
    totalCount,
    filteredCount,
    isFilterPending,
    clearSearch: () => {
      setSearchQuery("");
      setDebouncedQuery("");
      setStatusFilter("");
    },
  };
}
