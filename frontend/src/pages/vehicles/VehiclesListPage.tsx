import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getVehicles, deleteVehicle, type VehicleListItem } from "../../api/vehicles";
import { useAuthStore } from "../../store/authStore";
import { VehicleList } from "../../components/vehicles/VehicleList";

export function VehiclesListPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<VehicleListItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["vehicles"],
    queryFn: async () => {
      const { data: res } = await getVehicles({ limit: 10_000 });
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
          <VehicleList
            vehicles={data}
            isLoading={isLoading}
            isError={isError}
            userRole={user?.role}
            onDeleteRequest={setDeleteTarget}
          />

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
