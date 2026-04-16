import { Link } from "react-router-dom";
import type { VehicleListItem } from "../../api/vehicles";
import { useVehicleSearch } from "../../hooks/useVehicleSearch";
import { formatCurrency } from "../../utils/currency";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  rented: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  sold: "bg-slate-100 text-slate-800",
  scrapped: "bg-red-100 text-red-800",
};

type VehicleListProps = {
  vehicles: VehicleListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  userRole?: string;
  onDeleteRequest: (vehicle: VehicleListItem) => void;
};

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function VehicleList({
  vehicles,
  isLoading,
  isError,
  userRole,
  onDeleteRequest,
}: VehicleListProps) {
  const {
    searchQuery,
    setSearchQuery,
    filteredVehicles,
    totalCount,
    filteredCount,
    clearSearch,
    isFilterPending,
    debouncedQuery,
  } = useVehicleSearch(vehicles);

  const showDelete = userRole === "admin" || userRole === "accountant";
  const hasQuery = searchQuery.trim().length > 0;
  const showNoMatchEmpty =
    !isLoading && !isError && totalCount > 0 && filteredCount === 0 && !isFilterPending;
  const showEmptyOrg = !isLoading && !isError && totalCount === 0;

  return (
    <div className="space-y-4 p-4">
      <div className="w-full rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-md ring-1 ring-slate-900/[0.04] sm:p-4">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="vehicle-search" className="sr-only">
              Search vehicles by license plate, VIN, driver, make, model, or status
            </label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              id="vehicle-search"
              type="search"
              autoComplete="off"
              placeholder="Search plate, VIN, driver, make/model, status…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full rounded-xl border border-white/50 bg-white/55 py-2.5 pl-10 text-sm text-slate-900 shadow-inner outline-none ring-sky-500/30 placeholder:text-slate-400 focus:border-sky-300/80 focus:ring-2 ${hasQuery ? "pr-[4.5rem]" : "pr-3"}`}
            />
            {hasQuery && (
              <button
                type="button"
                onClick={clearSearch}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900 sm:text-sm"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        {!isLoading && !isError && totalCount > 0 && (
          <p className="mt-2 text-xs text-slate-600 sm:text-sm">
            {hasQuery && isFilterPending ? (
              <span className="text-slate-500">Matching vehicles…</span>
            ) : debouncedQuery.trim() ? (
              <>
                Found{" "}
                <span className="font-semibold tabular-nums text-slate-800">
                  {filteredCount.toLocaleString()}
                </span>{" "}
                of <span className="tabular-nums">{totalCount.toLocaleString()}</span> vehicles
              </>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-slate-800">
                  {totalCount.toLocaleString()}
                </span>{" "}
                vehicle{totalCount === 1 ? "" : "s"}
              </>
            )}
          </p>
        )}
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          <div
            className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600"
            role="status"
            aria-label="Loading vehicles"
          />
          <p className="text-sm text-slate-500">Loading vehicles…</p>
        </div>
      )}

      {isError && <p className="px-1 text-sm text-red-600">Failed to load vehicles.</p>}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Vehicle</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">License plate</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Rent (daily / monthly)</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Current driver</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVehicles.map((v) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link to={`/vehicles/${v.id}`} className="font-medium text-sky-600 hover:text-sky-800">
                      {v.year ? `${v.year} ` : ""}
                      {v.make} {v.model}
                    </Link>
                    <span className="ml-1 text-xs text-slate-500">{v.vehicle_type}</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-mono">{v.license_plate}</div>
                    {v.vin && <div className="mt-0.5 text-xs text-slate-500">VIN: {v.vin}</div>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded px-2 py-0.5 text-xs font-medium capitalize ${
                        STATUS_COLORS[v.status] ?? "bg-slate-100 text-slate-800"
                      }`}
                    >
                      {v.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-700">
                    {formatCurrency(Number(v.daily_rent))} / {formatCurrency(Number(v.monthly_rent))}
                  </td>
                  <td className="px-3 py-2 text-slate-600">
                    {v.current_driver_id ? (
                      <Link
                        to={`/drivers/${v.current_driver_id}`}
                        className="text-sky-600 hover:text-sky-800 text-sm"
                      >
                        {v.driver_first_name || v.driver_last_name
                          ? `${v.driver_first_name ?? ""} ${v.driver_last_name ?? ""}`.trim()
                          : "View driver"}
                        {v.driver_phone ? (
                          <span className="block text-xs text-slate-500">{v.driver_phone}</span>
                        ) : null}
                      </Link>
                    ) : v.driver_first_name || v.driver_last_name ? (
                      `${v.driver_first_name ?? ""} ${v.driver_last_name ?? ""}`.trim()
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 flex items-center gap-3">
                    <Link
                      to={`/vehicles/${v.id}/edit`}
                      className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                    >
                      Edit
                    </Link>
                    {showDelete && (
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(v)}
                        className="text-sm font-medium text-red-600 hover:text-red-800"
                      >
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {showEmptyOrg && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                    No vehicles yet.
                  </td>
                </tr>
              )}
              {showNoMatchEmpty && (
                <tr>
                  <td colSpan={6} className="px-3 py-10 text-center text-sm text-slate-500">
                    No vehicles match your search. Try a license plate, VIN, driver name, make/model, or status.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
