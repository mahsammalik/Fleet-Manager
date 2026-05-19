import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import Papa from "papaparse";
import {
  getDriverVehicleHistory,
  getVehicleDriverHistory,
  type AssignmentHistoryStatus,
  type VehicleAssignmentHistoryRow,
} from "../../api/vehicleAssignmentHistory";
import { useAuthStore } from "../../store/authStore";
import { formatCurrency } from "../../utils/currency";

type PanelMode = "driver" | "vehicle";

function toDateOnly(value: string | null | undefined): string {
  if (!value) return "";
  return value.split("T")[0] ?? "";
}

function formatDisplayDate(value: string | null | undefined): string {
  const d = toDateOnly(value);
  return d || "—";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function payoutPeriodLink(row: VehicleAssignmentHistoryRow): string {
  const from = toDateOnly(row.assigned_at);
  const to = toDateOnly(row.unassigned_at) || todayIso();
  const params = new URLSearchParams({
    driverId: row.driver_id,
    from,
    to,
  });
  return `/earnings/payouts?${params.toString()}`;
}

export function VehicleAssignmentHistoryPanel({
  mode,
  entityId,
  title,
}: {
  mode: PanelMode;
  entityId: string;
  title: string;
}) {
  const user = useAuthStore((s) => s.user);
  const canView = user?.role === "admin" || user?.role === "accountant";

  const [status, setStatus] = useState<AssignmentHistoryStatus>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  const filters = useMemo(
    () => ({
      status,
      from: from || undefined,
      to: to || undefined,
      q: debouncedQ || undefined,
    }),
    [status, from, to, debouncedQ],
  );

  const query = useQuery({
    queryKey: ["vehicle-assignment-history", mode, entityId, filters],
    queryFn: () =>
      (mode === "driver"
        ? getDriverVehicleHistory(entityId, filters)
        : getVehicleDriverHistory(entityId, filters)
      ).then((r) => r.data.items),
    enabled: canView && Boolean(entityId),
  });

  const items = query.data ?? [];

  async function exportCsv() {
    if (!items.length) return;
    setCsvBusy(true);
    try {
      const csv =
        mode === "driver"
          ? Papa.unparse(
              items.map((r) => ({
                vehicle: r.vehicle_name || `${r.make ?? ""} ${r.model ?? ""}`.trim(),
                plate: r.license_plate ?? "",
                assigned: toDateOnly(r.assigned_at),
                returned: r.unassigned_at ? toDateOnly(r.unassigned_at) : "Active",
                days_held: r.days_held,
                weekly_rent: r.weekly_rent_at_time ?? "",
                total_rent_paid: r.total_rent_paid,
                notes: r.notes ?? "",
              })),
            )
          : Papa.unparse(
              items.map((r) => ({
                driver: r.driver_name,
                phone: r.driver_phone ?? "",
                assigned: toDateOnly(r.assigned_at),
                returned: r.unassigned_at ? toDateOnly(r.unassigned_at) : "Active",
                days_held: r.days_held,
                weekly_rent: r.weekly_rent_at_time ?? "",
                total_rent_collected: r.total_rent_paid,
                notes: r.notes ?? "",
              })),
            );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${mode}-assignment-history-${entityId.slice(0, 8)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvBusy(false);
    }
  }

  if (!canView) return null;

  return (
    <section className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <button
          type="button"
          onClick={() => void exportCsv()}
          disabled={csvBusy || items.length === 0}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {csvBusy ? "Exporting…" : "Export CSV"}
        </button>
      </div>

      <div className="flex flex-wrap gap-3 mb-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">From</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">To</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-slate-500">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as AssignmentHistoryStatus)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="returned">Returned</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[12rem] flex-1">
          <span className="text-xs text-slate-500">Search</span>
          <input
            type="search"
            placeholder={mode === "driver" ? "Plate, make, model…" : "Driver name, phone…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1 w-full"
          />
        </label>
      </div>

      {query.isLoading && <p className="text-sm text-slate-500">Loading history…</p>}
      {query.isError && (
        <p className="text-sm text-red-600">Failed to load assignment history.</p>
      )}
      {!query.isLoading && !query.isError && items.length === 0 && (
        <p className="text-sm text-slate-500">No assignment history yet.</p>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                {mode === "driver" ? (
                  <>
                    <th className="px-2 py-2 font-medium">Vehicle</th>
                    <th className="px-2 py-2 font-medium">Plate</th>
                  </>
                ) : (
                  <>
                    <th className="px-2 py-2 font-medium">Driver</th>
                    <th className="px-2 py-2 font-medium">Phone</th>
                  </>
                )}
                <th className="px-2 py-2 font-medium">Assigned</th>
                <th className="px-2 py-2 font-medium">Returned</th>
                <th className="px-2 py-2 font-medium text-right">Days</th>
                <th className="px-2 py-2 font-medium text-right">Weekly rent</th>
                <th className="px-2 py-2 font-medium text-right">
                  {mode === "driver" ? "Total rent paid" : "Total rent collected"}
                </th>
                <th className="px-2 py-2 font-medium">Notes</th>
                {mode === "driver" && <th className="px-2 py-2 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-slate-100">
                  {mode === "driver" ? (
                    <>
                      <td className="px-2 py-2">
                        <Link
                          to={`/vehicles/${row.vehicle_id}`}
                          className="text-sky-600 hover:underline"
                        >
                          {row.vehicle_name?.trim() ||
                            `${row.make ?? ""} ${row.model ?? ""}`.trim() ||
                            "Vehicle"}
                        </Link>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{row.license_plate ?? "—"}</td>
                    </>
                  ) : (
                    <>
                      <td className="px-2 py-2">
                        <Link
                          to={`/drivers/${row.driver_id}`}
                          className="text-sky-600 hover:underline"
                        >
                          {row.driver_name || "Driver"}
                        </Link>
                      </td>
                      <td className="px-2 py-2">{row.driver_phone ?? "—"}</td>
                    </>
                  )}
                  <td className="px-2 py-2 whitespace-nowrap">{formatDisplayDate(row.assigned_at)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">
                    {row.is_active || !row.unassigned_at ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                        Active
                      </span>
                    ) : (
                      formatDisplayDate(row.unassigned_at)
                    )}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{row.days_held}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {row.weekly_rent_at_time != null
                      ? formatCurrency(Number(row.weekly_rent_at_time))
                      : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatCurrency(Number(row.total_rent_paid ?? 0))}
                  </td>
                  <td className="px-2 py-2 max-w-[10rem] truncate text-slate-600" title={row.notes ?? undefined}>
                    {row.notes || "—"}
                  </td>
                  {mode === "driver" && (
                    <td className="px-2 py-2 whitespace-nowrap">
                      <Link
                        to={payoutPeriodLink(row)}
                        className="text-xs text-sky-600 hover:underline"
                      >
                        View payouts
                      </Link>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
