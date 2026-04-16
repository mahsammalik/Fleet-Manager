import { useEffect, useMemo, useState } from "react";
import type { VehicleListItem } from "../api/vehicles";

const DEFAULT_DEBOUNCE_MS = 300;

function vehicleMatchesQuery(vehicle: VehicleListItem, q: string): boolean {
  const n = q.trim().toLowerCase();
  if (!n) return true;

  const driverName = `${vehicle.driver_first_name ?? ""} ${vehicle.driver_last_name ?? ""}`.trim();
  const haystacks = [
    vehicle.license_plate,
    vehicle.vin ?? "",
    vehicle.make,
    vehicle.model,
    `${vehicle.make} ${vehicle.model}`,
    vehicle.vehicle_type,
    vehicle.status,
    driverName,
    vehicle.driver_first_name ?? "",
    vehicle.driver_last_name ?? "",
    vehicle.driver_phone ?? "",
    vehicle.current_driver_id ?? "",
  ];

  return haystacks.some((chunk) => String(chunk).toLowerCase().includes(n));
}

export function useVehicleSearch(
  vehicles: VehicleListItem[] | undefined,
  debounceMs: number = DEFAULT_DEBOUNCE_MS,
) {
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQuery(searchQuery), debounceMs);
    return () => window.clearTimeout(id);
  }, [searchQuery, debounceMs]);

  const filteredVehicles = useMemo(() => {
    if (!vehicles?.length) return [];
    return vehicles.filter((v) => vehicleMatchesQuery(v, debouncedQuery));
  }, [vehicles, debouncedQuery]);

  const totalCount = vehicles?.length ?? 0;
  const filteredCount = filteredVehicles.length;
  const isFilterPending = searchQuery !== debouncedQuery;

  return {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    filteredVehicles,
    totalCount,
    filteredCount,
    clearSearch: () => {
      setSearchQuery("");
      setDebouncedQuery("");
    },
    isFilterPending,
  };
}
