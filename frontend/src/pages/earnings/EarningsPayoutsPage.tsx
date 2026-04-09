import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../../store/authStore";
import { bulkUpdatePayouts, getEarningsPayouts, getPayoutsWithProrationDetails } from "../../api/earnings";
import { formatCurrency } from "../../utils/currency";
import { Tooltip } from "../../components/UI/Tooltip";

function errMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const m = e.response?.data as { message?: string } | undefined;
    if (m?.message) return m.message;
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong";
}

export function EarningsPayoutsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const driverIdFromUrl =
    searchParams.get("driverId")?.trim() || searchParams.get("driver_id")?.trim() || undefined;

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["earnings", "payouts", page, status, from, to, q, driverIdFromUrl],
    queryFn: () =>
      getEarningsPayouts({
        page,
        pageSize: 25,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q.trim() || undefined,
        driverId: driverIdFromUrl,
      }).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  const items = query.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 25)));

  const detailsQuery = useQuery({
    queryKey: ["earnings", "payout-proration-details", page, status, from, to, q, driverIdFromUrl],
    queryFn: () =>
      getPayoutsWithProrationDetails({
        page,
        pageSize: 25,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: q.trim() || undefined,
        driverId: driverIdFromUrl,
      }).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });
  const detailsByPayoutId = useMemo(
    () => new Map((detailsQuery.data?.items ?? []).map((d) => [d.payout_id, d])),
    [detailsQuery.data?.items],
  );

  const allIds = useMemo(() => items.map((r) => r.id), [items]);
  const allSelected = items.length > 0 && items.every((r) => selected.has(r.id));

  const bulkMut = useMutation({
    mutationFn: () =>
      bulkUpdatePayouts({
        ids: [...selected],
        paymentStatus: "paid",
      }),
    onSuccess: () => {
      setSelected(new Set());
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (e) => setError(errMessage(e)),
  });

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Payouts</h1>
        <p className="text-sm text-slate-500 mt-1">Driver period rollups. Bulk mark as paid.</p>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-4">
        {error && <div className="rounded-lg bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>}

        {driverIdFromUrl && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-900">
            <span>Showing payouts for one driver (from vehicles or direct link).</span>
            <button
              type="button"
              className="text-sky-700 font-medium hover:underline"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("driverId");
                next.delete("driver_id");
                setSearchParams(next);
                setPage(1);
              }}
            >
              Clear driver filter
            </button>
          </div>
        )}

        <div className="flex flex-col lg:flex-row flex-wrap gap-3 items-stretch lg:items-end">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
            <div>
              <label className="block text-xs text-slate-600 mb-1">Status</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm min-h-[44px]"
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value);
                }}
              >
                <option value="">All</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="hold">Hold</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">From</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm min-h-[44px]"
                value={from}
                onChange={(e) => {
                  setPage(1);
                  setFrom(e.target.value);
                }}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">To</label>
              <input
                type="date"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm min-h-[44px]"
                value={to}
                onChange={(e) => {
                  setPage(1);
                  setTo(e.target.value);
                }}
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label className="block text-xs text-slate-600 mb-1">Search</label>
              <input
                type="search"
                placeholder="Name or phone"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm min-h-[44px]"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setPage(1);
                    void query.refetch();
                  }
                }}
              />
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50 min-h-[44px]"
            onClick={() => {
              setPage(1);
              void query.refetch();
            }}
          >
            Apply filters
          </button>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3">
            <span className="text-sm text-sky-900">{selected.size} selected</span>
            <button
              type="button"
              disabled={bulkMut.isPending}
              onClick={() => bulkMut.mutate()}
              className="rounded-lg bg-sky-600 text-white text-sm font-medium px-4 py-2 min-h-[44px] hover:bg-sky-700 disabled:opacity-50"
            >
              {bulkMut.isPending ? "Updating…" : "Mark paid"}
            </button>
            <button
              type="button"
              className="text-sm text-slate-600 hover:underline"
              onClick={() => setSelected(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm">
          {query.isLoading ? (
            <p className="p-4 text-sm text-slate-500">Loading…</p>
          ) : (
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-600 text-xs">
                <tr>
                  <th className="px-3 py-2 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all on page"
                      className="rounded border-slate-300"
                    />
                  </th>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2">Net payout</th>
                  <th className="px-3 py-2">Vehicle rental</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Paid</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row) => (
                  <tr key={row.id} className="text-slate-800">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleOne(row.id)}
                        disabled={row.payment_status === "paid"}
                        className="rounded border-slate-300"
                        aria-label={`Select ${row.first_name}`}
                      />
                    </td>
                    <td className="px-3 py-2">
                      {row.first_name} {row.last_name}
                      <div className="text-xs text-slate-500">{row.phone ?? ""}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      {row.payment_period_start?.slice(0, 10)} – {row.payment_period_end?.slice(0, 10)}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {row.net_driver_payout != null ? formatCurrency(Number(row.net_driver_payout)) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700">
                      {row.vehicle_rental_fee != null && Number(row.vehicle_rental_fee) !== 0 ? (
                        <div className="inline-flex items-center gap-1.5">
                          <span>{formatCurrency(Number(row.vehicle_rental_fee))}</span>
                          {(() => {
                            const d = detailsByPayoutId.get(row.id);
                            if (!d || !d.rental_amount || !d.rental_start_date || !d.rental_end_date) return null;
                            const pct = Number(d.overlap_pct ?? "0");
                            const pctText = Number.isFinite(pct) ? `${pct.toFixed(0)}%` : "—";
                            const content = `Weekly Rental: ${formatCurrency(Number(d.rental_amount))} (${d.rental_start_date.slice(0, 10)}-${d.rental_end_date.slice(0, 10)})\nProrated: ${formatCurrency(Number(row.vehicle_rental_fee))} (${pctText} overlap)`;
                            return <Tooltip content={content} align="right" />;
                          })()}
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                        {row.payment_status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">{row.payment_date?.slice(0, 10) ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex justify-center gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Previous
          </button>
          <span className="text-sm text-slate-600 py-2">
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
