import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { deleteDriver, type DriverListItem } from "../../api/drivers";
import { useAuthStore } from "../../store/authStore";
import { DriverAvatar } from "../../components/drivers/DriverAvatar";

export function DriversListPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<DriverListItem | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["drivers"],
    queryFn: async () => {
      const { data } = await api.get<DriverListItem[]>("/drivers");
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
      <main className="p-6">
        <div className="bg-white shadow-sm rounded-xl p-4">
          {isLoading && <p className="text-sm text-slate-500">Loading drivers...</p>}
          {isError && <p className="text-sm text-red-600">Failed to load drivers.</p>}
          {!isLoading && !isError && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-slate-700 w-12">Photo</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Name</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Phone</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Commission</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Uber/Bolt</th>
                  <th className="px-3 py-2 text-left font-medium text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((driver) => (
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
                    <td className="px-3 py-2 text-xs text-slate-600">
                      Uber: {driver.uber_driver_id || "-"} · Bolt: {driver.bolt_driver_id || "-"} · Glovo: {driver.glovo_courier_id || "-"} · Bolt C: {driver.bolt_courier_id || "-"}
                    </td>
                    <td className="px-3 py-2 flex items-center gap-3">
                      <Link
                        to={`/drivers/${driver.id}/edit`}
                        className="text-sky-600 hover:text-sky-800 text-sm font-medium"
                      >
                        Edit
                      </Link>
                      {(user?.role === "admin" || user?.role === "accountant") && (
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(driver)}
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
                    <td colSpan={7} className="px-3 py-4 text-center text-sm text-slate-500">
                      No drivers yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

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

