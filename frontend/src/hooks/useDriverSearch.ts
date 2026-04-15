import { useEffect, useMemo, useState } from "react";
import type { DriverListItem } from "../api/drivers";

const DEFAULT_DEBOUNCE_MS = 300;

function driverMatchesQuery(driver: DriverListItem, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;

  const haystacks = [
    driver.first_name,
    driver.last_name,
    `${driver.first_name} ${driver.last_name}`,
    driver.phone,
    driver.id,
    driver.email ?? "",
    driver.employment_status,
    driver.address ?? "",
    driver.license_number ?? "",
    driver.uber_driver_id ?? "",
    driver.bolt_driver_id ?? "",
    driver.glovo_courier_id ?? "",
    driver.bolt_courier_id ?? "",
    driver.wolt_courier_id ?? "",
    driver.current_vehicle_license_plate ?? "",
    `${driver.current_vehicle_make ?? ""} ${driver.current_vehicle_model ?? ""}`.trim(),
  ];

  return haystacks.some((chunk) => String(chunk).toLowerCase().includes(n));
}

export function useDriverSearch(
  drivers: DriverListItem[] | undefined,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery), debounceMs);
    return () => window.clearTimeout(id);
  }, [searchQuery, debounceMs]);

  const filteredDrivers = useMemo(() => {
    if (!drivers?.length) return [];
    return drivers.filter((d) => driverMatchesQuery(d, debouncedQuery));
  }, [drivers, debouncedQuery]);

  const totalCount = drivers?.length ?? 0;
  const filteredCount = filteredDrivers.length;
  const isFilterPending = searchQuery !== debouncedQuery;

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    filteredDrivers,
    totalCount,
    filteredCount,
    clearSearch: () => {
      setSearchQuery("");
      setDebouncedQuery("");
    },
    isFilterPending,
  };
}
