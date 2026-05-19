import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { getSubcontractors } from "../../api/subcontractors";

export function SubcontractorsListPage() {
  const user = useAuthStore((s) => s.user);
  const q = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => getSubcontractors().then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  return (
    <div className="min-h-full bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/dashboard" className="text-sm text-slate-600 hover:text-slate-900">
            Dashboard
          </Link>
          <h1 className="text-xl font-semibold text-slate-900">Subcontractors</h1>
        </div>
        <Link
          to="/subcontractors/new"
          className="inline-flex items-center rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          Add subcontractor
        </Link>
      </header>
      <main className="p-4 sm:p-6">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {q.isLoading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
          {q.isError && <p className="p-4 text-sm text-red-700">Failed to load.</p>}
          {q.data && (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-left">
                <tr>
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Drivers</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {q.data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-2 font-medium text-slate-900">{s.legal_name}</td>
                    <td className="px-4 py-2 capitalize">{s.status}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.driver_count ?? 0}</td>
                    <td className="px-4 py-2 text-right">
                      <Link to={`/subcontractors/${s.id}/edit`} className="text-sky-700 hover:underline">
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
    </div>
  );
}
