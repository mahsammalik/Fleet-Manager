import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { useAuthStore } from "../../store/authStore";
import { bulkUpdatePayouts, getEarningsPayouts, getPayoutsWithProrationDetails } from "../../api/earnings";
import { DriverPayoutTable } from "../../components/earnings/DriverPayoutTable";

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
  const [debouncedQ, setDebouncedQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [payingRowId, setPayingRowId] = useState<string | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(id);
  }, [q]);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ]);

  const query = useQuery({
    queryKey: ["earnings", "payouts", page, status, from, to, debouncedQ, driverIdFromUrl],
    queryFn: () =>
      getEarningsPayouts({
        page,
        pageSize: 25,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: debouncedQ || undefined,
        driverId: driverIdFromUrl,
      }).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  const items = query.data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / (query.data?.pageSize ?? 25)));

  const detailsQuery = useQuery({
    queryKey: ["earnings", "payout-proration-details", page, status, from, to, debouncedQ, driverIdFromUrl],
    queryFn: () =>
      getPayoutsWithProrationDetails({
        page,
        pageSize: 25,
        status: status || undefined,
        from: from || undefined,
        to: to || undefined,
        q: debouncedQ || undefined,
        driverId: driverIdFromUrl,
      }).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });
  const detailsByPayoutId = useMemo(
    () => new Map((detailsQuery.data?.items ?? []).map((d) => [d.payout_id, d])),
    [detailsQuery.data?.items],
  );

  const bulkMut = useMutation({
    mutationFn: (ids: string[]) =>
      bulkUpdatePayouts({
        ids,
        paymentStatus: "paid",
      }),
    onSuccess: () => {
      setSelected(new Set());
      setError(null);
      setPayingRowId(null);
      void queryClient.invalidateQueries({ queryKey: ["earnings"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard", "stats"] });
    },
    onError: (e) => setError(errMessage(e)),
  });

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
                <option value="processing">Processing</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="failed">Failed</option>
                <option value="hold">Hold</option>
                <option value="debt">Debt</option>
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
                placeholder="Name, phone, platform ID"
                className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm min-h-[44px]"
                value={q}
                onChange={(e) => setQ(e.target.value)}
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

        <DriverPayoutTable
          rows={items}
          detailsByPayoutId={detailsByPayoutId}
          selectedIds={selected}
          isLoading={query.isLoading}
          isPaying={bulkMut.isPending}
          payingRowId={payingRowId}
          errorMessage={error}
          onToggleSelection={toggleOne}
          onReplaceSelection={(ids) => setSelected(new Set(ids))}
          onPayNow={async (id) => {
            setPayingRowId(id);
            await bulkMut.mutateAsync([id]);
          }}
          onPaySelected={async (ids) => {
            setPayingRowId(null);
            await bulkMut.mutateAsync(ids);
          }}
        />

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
