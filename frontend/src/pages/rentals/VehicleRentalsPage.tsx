import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  bulkCreateNextWeekRentals,
  getActiveVehicleRentals,
  type ActiveVehicleRentalRow,
} from "../../api/rentals";
import { ConfirmDialog } from "../../components/UI/ConfirmDialog";
import { formatCurrency } from "../../utils/currency";

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  return value.split("T")[0];
}

export function VehicleRentalsPage() {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulk, setConfirmBulk] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["activeVehicleRentals"],
    queryFn: () => getActiveVehicleRentals({ limit: 500 }),
  });

  const rentals = data?.data ?? [];

  const bulkMutation = useMutation({
    mutationFn: (rental_ids: string[]) => bulkCreateNextWeekRentals(rental_ids),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["activeVehicleRentals"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      queryClient.invalidateQueries({ queryKey: ["vehicleRentals"] });
      setSelectedIds([]);
      setConfirmBulk(false);
      const failed = res.data.failed ?? [];
      if (failed.length > 0) {
        console.warn("Some rentals failed to roll forward:", failed);
      }
    },
  });

  const selectableRentals = useMemo(() => rentals.filter((r) => r.status === "active"), [rentals]);

  const allSelectableSelected = useMemo(
    () =>
      selectableRentals.length > 0 && selectableRentals.every((r) => selectedIds.includes(r.rental_id)),
    [selectableRentals, selectedIds],
  );

  const toggleSelection = (rentalId: string, status: string) => {
    if (status !== "active") return;
    setSelectedIds((prev) =>
      prev.includes(rentalId) ? prev.filter((id) => id !== rentalId) : [...prev, rentalId],
    );
  };

  const selectAllActive = () => {
    setSelectedIds(selectableRentals.map((r) => r.rental_id));
  };

  const selectNone = () => setSelectedIds([]);

  if (isLoading) {
    return <div className="p-6 text-sm text-slate-600">Loading active rentals...</div>;
  }

  if (isError) {
    return <div className="p-6 text-sm text-red-600">Failed to load active rentals.</div>;
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="border-b border-slate-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Vehicle rentals</h1>
            <p className="text-sm text-slate-500">
              Active rentals. Roll forward completes the current period and opens the next period of the same length.
            </p>
          </div>
          <Link to="/dashboard" className="text-sm text-sky-600 hover:underline">
            Back to dashboard
          </Link>
        </div>
      </header>

      <main className="space-y-4 p-6">
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={selectAllActive}
            disabled={selectableRentals.length === 0}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Select all active
          </button>
          <button
            type="button"
            onClick={selectNone}
            disabled={selectedIds.length === 0}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setConfirmBulk(true)}
            disabled={selectedIds.length === 0 || bulkMutation.isPending}
            className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {bulkMutation.isPending
              ? "Creating…"
              : `Create next week rentals (${selectedIds.length})`}
          </button>
        </div>

        {bulkMutation.isError && (
          <p className="text-sm text-red-600">Request failed. Try again or check the console.</p>
        )}
        {bulkMutation.isSuccess && bulkMutation.data?.data.failed?.length ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Created {bulkMutation.data.data.created}. Failed {bulkMutation.data.data.failed.length}:{" "}
            {bulkMutation.data.data.failed.map((f) => `${f.rentalId}: ${f.message}`).join("; ")}
          </div>
        ) : null}

        <section className="rounded-xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm text-slate-600">{rentals.length} active rentals</p>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left">
                  <th className="px-3 py-2 font-medium text-slate-700">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={allSelectableSelected}
                      disabled={selectableRentals.length === 0}
                      onChange={() => (allSelectableSelected ? selectNone() : selectAllActive())}
                      aria-label="Select all active rentals"
                    />
                  </th>
                  <th className="px-3 py-2 font-medium text-slate-700">Driver</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Plate</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Period</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Type</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Rent</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Status</th>
                  <th className="px-3 py-2 font-medium text-slate-700">Vehicle</th>
                </tr>
              </thead>
              <tbody>
                {rentals.map((r: ActiveVehicleRentalRow) => {
                  const driverName = `${r.driver_first_name} ${r.driver_last_name}`.trim();
                  const canSelect = r.status === "active";
                  return (
                    <tr key={r.rental_id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          className="rounded border-slate-300"
                          checked={selectedIds.includes(r.rental_id)}
                          disabled={!canSelect}
                          onChange={() => toggleSelection(r.rental_id, r.status)}
                          aria-label={`Select rental ${r.rental_id}`}
                        />
                      </td>
                      <td className="px-3 py-2">{driverName || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.license_plate}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDate(r.rental_start_date)} → {formatDate(r.rental_end_date)}
                      </td>
                      <td className="px-3 py-2 capitalize">{r.rental_type ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {r.total_rent_amount != null && r.total_rent_amount !== ""
                          ? formatCurrency(Number(r.total_rent_amount))
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                            r.status === "active"
                              ? "bg-emerald-100 text-emerald-800"
                              : "bg-slate-100 text-slate-600"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/vehicles/${r.vehicle_id}`}
                          className="text-sky-600 hover:underline"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rentals.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">No active rentals.</p>
            )}
          </div>
        </section>
      </main>

      <ConfirmDialog
        open={confirmBulk}
        onClose={() => !bulkMutation.isPending && setConfirmBulk(false)}
        title="Create next period rentals?"
        description={
          <p className="text-sm text-slate-600">
            For each selected rental, the current contract will be marked completed (as of its end date) and a new
            active rental will start the following day for the same number of days. Deposit on the new period defaults to
            zero (see notes on the new rental).
          </p>
        }
        confirmLabel={bulkMutation.isPending ? "Working…" : `Roll forward ${selectedIds.length}`}
        isLoading={bulkMutation.isPending}
        onConfirm={() => bulkMutation.mutateAsync(selectedIds).then(() => undefined)}
      />
    </div>
  );
}
