import { Link } from "react-router-dom";
import type { DriverListItem } from "../../api/drivers";
import {
  PLATFORM_IDS,
  PLATFORM_ID_LABELS,
} from "../../constants/platformIds";
import { useDriverSearch } from "../../hooks/useDriverSearch";
import { DriverAvatar } from "./DriverAvatar";

type DriversListProps = {
  drivers: DriverListItem[] | undefined;
  isLoading: boolean;
  isError: boolean;
  userRole?: string;
  onDeleteRequest: (driver: DriverListItem) => void;
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

export function DriversList({
  drivers,
  isLoading,
  isError,
  userRole,
  onDeleteRequest,
}: DriversListProps) {
  const {
    searchQuery,
    setSearchQuery,
    filteredDrivers,
    totalCount,
    filteredCount,
    clearSearch,
    isFilterPending,
    debouncedQuery,
  } = useDriverSearch(drivers);

  const showDelete = userRole === "admin" || userRole === "accountant";
  const hasQuery = searchQuery.trim().length > 0;
  const showNoMatchEmpty = !isLoading && !isError && totalCount > 0 && filteredCount === 0 && !isFilterPending;
  const showEmptyOrg = !isLoading && !isError && totalCount === 0;

  return (
    <div className="space-y-4">
      <div className="w-full rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-md ring-1 ring-slate-900/[0.04] sm:p-4">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-stretch sm:gap-3">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="driver-search" className="sr-only">
              Search drivers by name, phone, ID, or city
            </label>
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              <SearchIcon />
            </span>
            <input
              id="driver-search"
              type="search"
              autoComplete="off"
              placeholder="Search name, phone, ID, city…"
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
              <span className="text-slate-500">Matching drivers…</span>
            ) : debouncedQuery.trim() ? (
              <>
                Found <span className="font-semibold tabular-nums text-slate-800">{filteredCount.toLocaleString()}</span>{" "}
                of <span className="tabular-nums">{totalCount.toLocaleString()}</span>
              </>
            ) : (
              <>
                <span className="font-semibold tabular-nums text-slate-800">{totalCount.toLocaleString()}</span>{" "}
                driver{totalCount === 1 ? "" : "s"}
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
            aria-label="Loading drivers"
          />
          <p className="text-sm text-slate-500">Loading drivers…</p>
        </div>
      )}

      {isError && <p className="text-sm text-red-600">Failed to load drivers.</p>}

      {!isLoading && !isError && (
        <div className="overflow-x-auto rounded-xl border border-slate-100">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-700 w-12">Photo</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Name</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Phone</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Commission</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Vehicle</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Uber/Bolt</th>
                <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredDrivers.map((driver) => (
                <tr key={driver.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <Link to={`/drivers/${driver.id}`} className="flex items-center gap-2">
                      <DriverAvatar
                        profilePhotoUrl={driver.profile_photo_url}
                        firstName={driver.first_name}
                        lastName={driver.last_name}
                        size="sm"
                      />
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/drivers/${driver.id}`}
                      className="font-medium text-sky-600 hover:text-sky-800"
                    >
                      {driver.first_name} {driver.last_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{driver.phone}</td>
                  <td className="px-3 py-2 capitalize">{driver.employment_status}</td>
                  <td className="px-3 py-2">{driver.commission_rate}%</td>
                  <td className="px-3 py-2 text-slate-600">
                    {driver.current_vehicle_id ? (
                      <Link
                        to={`/vehicles/${driver.current_vehicle_id}`}
                        className="text-sky-600 hover:text-sky-800 text-sm"
                      >
                        {driver.current_vehicle_make || driver.current_vehicle_model
                          ? `${driver.current_vehicle_make ?? ""} ${driver.current_vehicle_model ?? ""}`.trim()
                          : driver.current_vehicle_license_plate ?? "View vehicle"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.UBER]}: {driver.uber_driver_id || "-"} ·{" "}
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.BOLT]}: {driver.bolt_driver_id || "-"} ·{" "}
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.GLOVO]}: {driver.glovo_courier_id || "-"} ·{" "}
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.BOLT_COURIER]}: {driver.bolt_courier_id || "-"} ·{" "}
                    {PLATFORM_ID_LABELS[PLATFORM_IDS.WOLT]}: {driver.wolt_courier_id || "-"}
                  </td>
                  <td className="px-3 py-2 flex items-center gap-3">
                    <Link
                      to={`/drivers/${driver.id}/edit`}
                      className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                    >
                      Edit
                    </Link>
                    {showDelete && (
                      <button
                        type="button"
                        onClick={() => onDeleteRequest(driver)}
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
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">
                    No drivers yet.
                  </td>
                </tr>
              )}
              {showNoMatchEmpty && (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-sm text-slate-500">
                    No drivers match your search. Try another name, phone number, or ID.
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
