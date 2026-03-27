import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkCompleteOverdueRentals,
  completeOverdueRental,
  extendRentalPeriod,
  getOverdueRentals,
  type OverdueRentalItem,
} from "../../api/rentals";
import { formatCurrency } from "../../utils/currency";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.split("T")[0];
}

export function OverdueRentalsPage() {
  const queryClient = useQueryClient();
  const [minOverdueDays, setMinOverdueDays] = useState<number | "">("");
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [extendRentalId, setExtendRentalId] = useState<string | null>(null);
  const [newEndDate, setNewEndDate] = useState("");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["overdueRentals", minOverdueDays, vehicleId, driverId],
    queryFn: () =>
      getOverdueRentals({
        minOverdueDays: minOverdueDays === "" ? undefined : Number(minOverdueDays),
        vehicleId: vehicleId || undefined,
        driverId: driverId || undefined,
      }),
  });

  const rentals = data?.data ?? [];

  const completeMutation = useMutation({
    mutationFn: (rentalId: string) => completeOverdueRental(rentalId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overdueRentals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
    },
  });

  const extendMutation = useMutation({
    mutationFn: ({ rentalId, endDate }: { rentalId: string; endDate: string }) =>
      extendRentalPeriod(rentalId, endDate),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overdueRentals"] });
      setExtendRentalId(null);
      setNewEndDate("");
    },
  });

  const bulkCompleteMutation = useMutation({
    mutationFn: (rentalIds: string[]) => bulkCompleteOverdueRentals(rentalIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["overdueRentals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setSelectedIds([]);
    },
  });

  const allSelected = useMemo(
    () => rentals.length > 0 && rentals.every((r) => selectedIds.includes(r.rental_id)),
    [rentals, selectedIds],
  );

  const toggleSelection = (rentalId: string) => {
    setSelectedIds((prev) =>
      prev.includes(rentalId) ? prev.filter((id) => id !== rentalId) : [...prev, rentalId],
    );
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-600">Loading overdue rentals...</div>;
  }

  if (isError) {
    return <div className="p-6 text-sm text-red-600">Failed to load overdue rentals.</div>;
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Overdue rentals</h1>
            <p className="text-sm text-slate-500">Vehicles with active rentals past end date.</p>
          </div>
          <Link to="/dashboard" className="text-sm text-sky-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="p-6 space-y-4">
        <section className="bg-white rounded-xl shadow-sm p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input
              type="number"
              min={0}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Min overdue days"
              value={minOverdueDays}
              onChange={(e) => setMinOverdueDays(e.target.value ? Number(e.target.value) : "")}
            />
            <input
              type="text"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Filter by vehicle ID"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            />
            <input
              type="text"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="Filter by driver ID"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            />
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setMinOverdueDays("");
                setVehicleId("");
                setDriverId("");
              }}
            >
              Reset filters
            </button>
          </div>
        </section>

        <section className="bg-white rounded-xl shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-slate-600">{rentals.length} overdue rentals</p>
            <button
              type="button"
              disabled={selectedIds.length === 0 || bulkCompleteMutation.isPending}
              onClick={() => bulkCompleteMutation.mutate(selectedIds)}
              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {bulkCompleteMutation.isPending ? "Completing..." : `Complete selected (${selectedIds.length})`}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() =>
                        setSelectedIds(allSelected ? [] : rentals.map((r) => r.rental_id))
                      }
                    />
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Vehicle</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Driver</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">End date</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Overdue days</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Overdue amount</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Deposit</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rentals.map((r: OverdueRentalItem) => (
                  <tr key={r.rental_id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(r.rental_id)}
                        onChange={() => toggleSelection(r.rental_id)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {r.vehicle_make} {r.vehicle_model} ({r.license_plate})
                    </td>
                    <td className="px-3 py-2">{r.driver_first_name} {r.driver_last_name}</td>
                    <td className="px-3 py-2">{formatDate(r.rental_end_date)}</td>
                    <td className="px-3 py-2">{r.overdue_days}</td>
                    <td className="px-3 py-2">{formatCurrency(Number(r.overdue_amount))}</td>
                    <td className="px-3 py-2">
                      {formatCurrency(Number(r.deposit_amount ?? 0))}{" "}
                      <span className="text-xs text-slate-500">({r.deposit_status ?? "—"})</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => completeMutation.mutate(r.rental_id)}
                          disabled={completeMutation.isPending}
                          className="text-sky-600 hover:underline"
                        >
                          Complete
                        </button>
                        <button
                          type="button"
                          onClick={() => setExtendRentalId(r.rental_id)}
                          className="text-amber-600 hover:underline"
                        >
                          Extend
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {rentals.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-4 text-center text-slate-500">
                      No overdue rentals found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {extendRentalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-slate-900">Extend rental</h3>
            <p className="text-sm text-slate-600 mt-1">Select a new rental end date.</p>
            <input
              type="date"
              className="mt-3 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={newEndDate}
              onChange={(e) => setNewEndDate(e.target.value)}
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={!newEndDate || extendMutation.isPending}
                onClick={() => extendMutation.mutate({ rentalId: extendRentalId, endDate: newEndDate })}
                className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
              >
                {extendMutation.isPending ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExtendRentalId(null);
                  setNewEndDate("");
                }}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

