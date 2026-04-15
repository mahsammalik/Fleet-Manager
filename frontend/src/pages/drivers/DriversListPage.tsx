import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { deleteDriver, getDrivers, type DriverListItem } from "../../api/drivers";
import { useAuthStore } from "../../store/authStore";
import { DriversList } from "../../components/drivers/DriversList";

export function DriversListPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<DriverListItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["drivers", "list"],
    queryFn: async () => {
      const { data } = await getDrivers({ limit: 10_000 });
      return data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteDriver(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["drivers"] });
      setDeleteTarget(null);
    },
  });

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">Dashboard</Link>
          <h1 className="text-xl font-semibold text-slate-900">Drivers</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            to="/drivers/new"
            className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
          >
            Add driver
          </Link>
          {user && (
            <span className="text-sm text-slate-600">
              {user.firstName} {user.lastName} • {user.role}
            </span>
          )}
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <div className="rounded-xl bg-gradient-to-br from-slate-50 via-white to-sky-50/40 p-4 shadow-sm ring-1 ring-slate-200/80 sm:p-5">
          <DriversList
            drivers={data}
            isLoading={isLoading}
            isError={isError}
            userRole={user?.role}
            onDeleteRequest={setDeleteTarget}
          />
          {deleteTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-lg p-6 max-w-sm w-full">
                <h3 className="text-lg font-semibold text-slate-900">Delete driver?</h3>
                <p className="text-sm text-slate-600 mt-2">
                  {deleteTarget.first_name} {deleteTarget.last_name} will be removed from the active
                  list (soft delete). You can no longer view or edit them from the list.
                </p>
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => {
                      deleteMutation.mutate(deleteTarget.id);
                    }}
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

