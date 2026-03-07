import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getVehicles, deleteVehicle, type VehicleListItem } from "../../api/vehicles";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/currency";

const STATUS_COLORS: Record<string, string> = {
  available: "bg-green-100 text-green-800",
  rented: "bg-blue-100 text-blue-800",
  maintenance: "bg-amber-100 text-amber-800",
  sold: "bg-slate-100 text-slate-800",
  scrapped: "bg-red-100 text-red-800",
};

export function VehiclesListPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<VehicleListItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data: res } = await getVehicles();
      return res;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteVehicle(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vehicles"] });
      setDeleteTarget(null);
    },
  });

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">Vehicles</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/vehicles/new"
            className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Add vehicle
          </Link>
          {user && (
            <span className="text-sm text-slate-600">
              {user.firstName} {user.lastName} • {user.role}
            </span>
          )}
        </div>
      </header>
      <main className="p-6">
        <div className="bg-white shadow-sm rounded-xl overflow-hidden">
          {isLoading && (
            <p className="p-4 text-sm text-slate-500">Loading vehicles...</p>
          )}
          {isError && (
            <p className="p-4 text-sm text-red-600">Failed to load vehicles.</p>
          )}
          {!isLoading && !isError && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Vehicle
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    License plate
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Rent (daily / monthly)
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Current driver
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {data?.map((v) => (
                  <tr key={v.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <Link
                        to={`/vehicles/${v.id}`}
                        className="font-medium text-sky-600 hover:text-sky-800"
                      >
                        {v.year ? `${v.year} ` : ""}
                        {v.make} {v.model}
                      </Link>
                      <span className="text-slate-500 text-xs ml-1">
                        {v.vehicle_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono">{v.license_plate}</td>
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
                      {formatCurrency(Number(v.daily_rent))} /{" "}
                      {formatCurrency(Number(v.monthly_rent))}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {v.driver_first_name || v.driver_last_name
                        ? `${v.driver_first_name ?? ""} ${v.driver_last_name ?? ""}`.trim()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 flex items-center gap-3">
                      <Link
                        to={`/vehicles/${v.id}/edit`}
                        className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                      >
                        Edit
                      </Link>
                      {(user?.role === "admin" || user?.role === "accountant") && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(v)}
                          className="text-sm font-medium text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {data?.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-4 text-center text-sm text-slate-500"
                    >
                      No vehicles yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {deleteTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
                <h3 className="text-lg font-semibold text-slate-900">
                  Delete vehicle?
                </h3>
                <p className="text-sm text-slate-600 mt-2">
                  {deleteTarget.make} {deleteTarget.model} (
                  {deleteTarget.license_plate}) will be permanently deleted.
                  Rentals and maintenance records will be removed.
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate(deleteTarget.id)}
                    disabled={deleteMutation.isPending}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {deleteMutation.isPending ? "Deleting..." : "Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(null)}
                    disabled={deleteMutation.isPending}
                    className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
