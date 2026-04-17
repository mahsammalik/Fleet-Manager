import { Fragment, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { PayoutListItem, PayoutProrationDetail } from "../../api/earnings";
import { usePayoutSearch } from "../../hooks/usePayoutSearch";
import { ConfirmDialog } from "../UI/ConfirmDialog";
import { formatCurrency } from "../../utils/currency";

type DriverPayoutTableProps = {
  rows: PayoutListItem[];
  detailsByPayoutId: Map<string, PayoutProrationDetail>;
  selectedIds: Set<string>;
  isLoading: boolean;
  isPaying: boolean;
  payingRowId: string | null;
  errorMessage?: string | null;
  onToggleSelection: (id: string) => void;
  onReplaceSelection: (ids: string[]) => void;
  onPayNow: (id: string) => void | Promise<void>;
  onPaySelected: (ids: string[]) => void | Promise<void>;
};

const BADGE_BY_STATUS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  processing: "bg-violet-100 text-violet-800",
  approved: "bg-blue-100 text-blue-800",
  paid: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  hold: "bg-slate-100 text-slate-700",
  debt: "bg-red-100 text-red-800",
};

function periodLabel(row: PayoutListItem): string {
  const start = row.payment_period_start?.slice(0, 10) ?? "—";
  const end = row.payment_period_end?.slice(0, 10) ?? "—";
  return `${start} – ${end}`;
}

function toNum(value: string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function includesQuery(value: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return String(value ?? "").toLowerCase().includes(q);
}

function findPayoutRow(allRows: PayoutListItem[], id: string): PayoutListItem | undefined {
  return allRows.find((r) => r.id === id);
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lowerText = text.toLowerCase();
  const lowerQuery = q.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);
  if (index === -1) return <>{text}</>;
  const end = index + q.length;
  return (
    <>
      {text.slice(0, index)}
      <span className="rounded bg-yellow-200/90 px-1 text-slate-950 shadow-[0_0_10px_rgba(250,204,21,0.6)]">
        {text.slice(index, end)}
      </span>
      {text.slice(end)}
    </>
  );
}

export function DriverPayoutTable({
  rows,
  detailsByPayoutId,
  selectedIds,
  isLoading,
  isPaying,
  payingRowId,
  errorMessage,
  onToggleSelection,
  onReplaceSelection,
  onPayNow,
  onPaySelected,
}: DriverPayoutTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [payConfirm, setPayConfirm] = useState<
    null | { kind: "one"; payoutId: string } | { kind: "many"; ids: string[] }
  >(null);

  const {
    searchQuery,
    setSearchQuery,
    debouncedQuery,
    statusFilter,
    setStatusFilter,
    filteredRows,
    totalCount,
    filteredCount,
    isFilterPending,
    clearSearch,
  } = usePayoutSearch(rows);

  const hasQuery = searchQuery.trim().length > 0 || statusFilter.length > 0;
  const pendingIds = useMemo(
    () => filteredRows.filter((r) => r.payment_status === "pending").map((r) => r.id),
    [filteredRows],
  );
  const selectedPendingIds = pendingIds.filter((id) => selectedIds.has(id));
  const pendingTotal = filteredRows.reduce((sum, r) => (r.payment_status === "pending" ? sum + toNum(r.net_driver_payout) : sum), 0);
  const paidCount = filteredRows.filter((r) => r.payment_status === "paid").length;
  const platformIdMatchCount = filteredRows.filter((r) => includesQuery(r.platform_id, debouncedQuery)).length;

  const showNoRows = !isLoading && filteredRows.length === 0;

  const payConfirmRow = payConfirm?.kind === "one" ? findPayoutRow(rows, payConfirm.payoutId) : undefined;
  const payConfirmBulkTotal =
    payConfirm?.kind === "many"
      ? payConfirm.ids.reduce((sum, id) => sum + toNum(findPayoutRow(rows, id)?.net_driver_payout), 0)
      : 0;

  const handlePayConfirm = async () => {
    if (!payConfirm) return;
    if (payConfirm.kind === "one") {
      await onPayNow(payConfirm.payoutId);
    } else {
      await onPaySelected(payConfirm.ids);
    }
    setPayConfirm(null);
  };

  return (
    <div className="space-y-4">
      <div className="w-full rounded-2xl border border-white/60 bg-white/45 p-3 shadow-[0_8px_30px_rgb(0,0,0,0.06)] backdrop-blur-md ring-1 ring-slate-900/[0.04] sm:p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-2">
            <label htmlFor="payout-search" className="mb-1 block text-xs font-medium text-slate-600">
              Search driver, phone, period, platform ID, vehicle rental, status
            </label>
            <div className="relative">
              <input
                id="payout-search"
                type="search"
                autoComplete="off"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Bilal, 46bcf8, pending, 250"
                className={`w-full rounded-xl border border-white/50 bg-white/55 py-2.5 pl-3 text-sm text-slate-900 shadow-inner outline-none ring-sky-500/30 placeholder:text-slate-400 focus:border-sky-300/80 focus:ring-2 ${hasQuery ? "pr-[4.5rem]" : "pr-3"}`}
              />
              {hasQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900 sm:text-sm"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="payout-status" className="mb-1 block text-xs font-medium text-slate-600">
              Status
            </label>
            <select
              id="payout-status"
              className="w-full rounded-xl border border-white/50 bg-white/55 px-3 py-2.5 text-sm text-slate-900 shadow-inner outline-none ring-sky-500/30 focus:border-sky-300/80 focus:ring-2"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="processing">Processing</option>
              <option value="approved">Approved</option>
              <option value="paid">Paid</option>
              <option value="failed">Failed</option>
              <option value="hold">Hold</option>
              <option value="debt">Debt</option>
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200/70 bg-white/70 px-3 py-2">
            <p className="text-xs text-slate-500">Showing</p>
            <p className="text-sm font-semibold text-slate-900 tabular-nums">
              {isFilterPending ? "Filtering…" : `${filteredCount.toLocaleString()} of ${totalCount.toLocaleString()}`}
            </p>
            {!isFilterPending && debouncedQuery.trim() && (
              <p className="mt-1 text-xs text-slate-600">
                Found {platformIdMatchCount.toLocaleString()} matching platform ID{platformIdMatchCount === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 px-3 py-2">
            <p className="text-xs text-amber-700">Pending total</p>
            <p className="text-sm font-semibold text-amber-900 tabular-nums">{formatCurrency(pendingTotal)}</p>
          </div>
          <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2">
            <p className="text-xs text-emerald-700">Paid rows</p>
            <p className="text-sm font-semibold text-emerald-900 tabular-nums">{paidCount.toLocaleString()}</p>
          </div>
        </div>
      </div>

      {selectedPendingIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3">
          <span className="text-sm text-sky-900">{selectedPendingIds.length} pending selected</span>
          <button
            type="button"
            disabled={isPaying}
            onClick={() => setPayConfirm({ kind: "many", ids: [...selectedPendingIds] })}
            className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {isPaying ? "Updating…" : "Pay selected"}
          </button>
          <button
            type="button"
            className="rounded-lg border border-sky-300 px-3 py-2 text-sm text-sky-700 hover:bg-sky-100/60"
            onClick={() => onReplaceSelection([])}
          >
            Clear
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          onClick={() => onReplaceSelection(pendingIds)}
          disabled={pendingIds.length === 0}
        >
          Select all pending ({pendingIds.length})
        </button>
      </div>

      {errorMessage && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</div>}

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-4 py-6 text-sm text-slate-500">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600" />
          Loading payouts…
        </div>
      ) : showNoRows ? (
        <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-10 text-center text-sm text-slate-500">
          No payouts match your filters. Try driver name, platform ID, period dates, rental amount, or status.
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-2xl border border-slate-200/80 bg-white/70 backdrop-blur-sm shadow-sm md:block">
            <table className="min-w-full text-sm text-left">
              <thead className="bg-slate-50 text-xs text-slate-600">
                <tr>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Period</th>
                  <th className="px-3 py-2 text-right">Net Payout</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Vehicle Rental</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.map((row) => {
                  const detail = detailsByPayoutId.get(row.id);
                  const isExpanded = expanded.has(row.id);
                  const isDebtRow =
                    row.payment_status === "debt" ||
                    toNum(row.remaining_debt_amount) > 0 ||
                    toNum(row.debt_amount) > 0 ||
                    toNum(row.raw_net_amount) < 0 ||
                    toNum(row.net_driver_payout) < 0;
                  const isPending = row.payment_status === "pending" && !isDebtRow;
                  const isPayingRow = payingRowId === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className="align-top text-slate-800">
                        <td className="px-3 py-3">
                          <div className="font-medium">
                            <HighlightText text={`${row.first_name} ${row.last_name}`} query={debouncedQuery} />
                          </div>
                          <div className="text-xs text-slate-500">
                            <HighlightText text={row.phone || "No phone"} query={debouncedQuery} />
                          </div>
                          <div className="mt-1 text-xs text-slate-600">
                            Platform ID:{" "}
                            <span className="font-mono">
                              <HighlightText text={row.platform_id || "—"} query={debouncedQuery} />
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-xs text-slate-700">
                          <HighlightText text={periodLabel(row)} query={debouncedQuery} />
                        </td>
                        <td className="px-3 py-3 text-right">
                          <div className="text-lg font-bold tabular-nums text-slate-900">
                            {formatCurrency(toNum(row.net_driver_payout))}
                          </div>
                          {isDebtRow && (
                            <div className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-800">
                              DEBT {formatCurrency(-Math.max(toNum(row.remaining_debt_amount), toNum(row.debt_amount)))}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              BADGE_BY_STATUS[row.payment_status] ?? "bg-slate-100 text-slate-700"
                            }`}
                          >
                            <HighlightText text={row.payment_status} query={debouncedQuery} />
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <span className="inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                            <HighlightText
                              text={toNum(row.vehicle_rental_fee) ? formatCurrency(toNum(row.vehicle_rental_fee)) : "—"}
                              query={debouncedQuery}
                            />
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <input
                              type="checkbox"
                              className="rounded border-slate-300"
                              checked={selectedIds.has(row.id)}
                              onChange={() => onToggleSelection(row.id)}
                              disabled={!isPending || isPaying}
                              aria-label={`Select payout for ${row.first_name}`}
                            />
                            <button
                              type="button"
                              disabled={!isPending || isPaying}
                              onClick={() => setPayConfirm({ kind: "one", payoutId: row.id })}
                              className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                            >
                              {isPayingRow ? "Paying…" : "Pay Now"}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row.id)) next.delete(row.id);
                                  else next.add(row.id);
                                  return next;
                                })
                              }
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              {isExpanded ? "Hide" : "Details"}
                            </button>
                            <Link
                              to={`/earnings/reports?driverId=${encodeURIComponent(row.driver_id)}`}
                              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Export
                            </Link>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/80">
                          <td colSpan={6} className="px-3 py-3 text-xs text-slate-700">
                            <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                              <div>
                                <p className="font-semibold text-slate-800">Breakdown</p>
                                <p>Gross revenue: {formatCurrency(toNum(row.total_gross_earnings))}</p>
                                <p>Company commission: {formatCurrency(toNum(row.company_commission))}</p>
                                <p>Raw net: {formatCurrency(toNum(row.raw_net_amount))}</p>
                                <p>Debt applied: {formatCurrency(toNum(row.debt_applied_amount))}</p>
                                <p className="font-semibold text-red-700">
                                  Remaining debt: {formatCurrency(toNum(row.remaining_debt_amount))}
                                </p>
                                <p className="text-amber-800">
                                  Vehicle rental: {formatCurrency(toNum(row.vehicle_rental_fee))}
                                </p>
                                <p className="mt-1 font-semibold text-slate-900">
                                  Net payout: {formatCurrency(toNum(row.net_driver_payout))}
                                </p>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-800">Rental match</p>
                                <p>
                                  Rental amount:{" "}
                                  {detail?.rental_amount ? formatCurrency(toNum(detail.rental_amount)) : "—"}
                                </p>
                                <p>
                                  Rental period:{" "}
                                  {detail?.rental_start_date
                                    ? `${detail.rental_start_date.slice(0, 10)} – ${detail.rental_end_date?.slice(0, 10) ?? "—"}`
                                    : "—"}
                                </p>
                                <p>Rental type: {detail?.rental_type ?? "—"}</p>
                              </div>
                              <div>
                                <p className="font-semibold text-slate-800">Payment status</p>
                                <p>Status: {row.payment_status}</p>
                                <p>Paid on: {row.payment_date?.slice(0, 10) ?? "—"}</p>
                                <p>Payout ID: {row.id}</p>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {filteredRows.map((row) => {
              const detail = detailsByPayoutId.get(row.id);
              const isExpanded = expanded.has(row.id);
              const isDebtRow =
                row.payment_status === "debt" ||
                toNum(row.remaining_debt_amount) > 0 ||
                toNum(row.debt_amount) > 0 ||
                toNum(row.raw_net_amount) < 0 ||
                toNum(row.net_driver_payout) < 0;
              const isPending = row.payment_status === "pending" && !isDebtRow;
              const isPayingRow = payingRowId === row.id;
              return (
                <div key={row.id} className="rounded-2xl border border-slate-200/80 bg-white/80 p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">
                        <HighlightText text={`${row.first_name} ${row.last_name}`} query={debouncedQuery} />
                      </p>
                      <p className="text-xs text-slate-500">
                        <HighlightText text={row.phone || "No phone"} query={debouncedQuery} />
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Platform ID:{" "}
                        <span className="font-mono">
                          <HighlightText text={row.platform_id || "—"} query={debouncedQuery} />
                        </span>
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      className="mt-1 rounded border-slate-300"
                      checked={selectedIds.has(row.id)}
                      onChange={() => onToggleSelection(row.id)}
                      disabled={!isPending || isPaying}
                      aria-label={`Select payout for ${row.first_name}`}
                    />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xl font-bold tabular-nums text-slate-900">
                      {formatCurrency(toNum(row.net_driver_payout))}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        BADGE_BY_STATUS[row.payment_status] ?? "bg-slate-100 text-slate-700"
                      }`}
                    >
                      <HighlightText text={row.payment_status} query={debouncedQuery} />
                    </span>
                  </div>
                  {isDebtRow && (
                    <p className="mt-1 text-xs font-semibold text-red-700">
                      DEBT {formatCurrency(-Math.max(toNum(row.remaining_debt_amount), toNum(row.debt_amount)))}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-slate-600">
                    <HighlightText text={periodLabel(row)} query={debouncedQuery} /> | Vehicle:{" "}
                    <span className="font-semibold text-amber-800">
                      <HighlightText
                        text={toNum(row.vehicle_rental_fee) ? formatCurrency(toNum(row.vehicle_rental_fee)) : "—"}
                        query={debouncedQuery}
                      />
                    </span>
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={!isPending || isPaying}
                      onClick={() => setPayConfirm({ kind: "one", payoutId: row.id })}
                      className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      {isPayingRow ? "Paying…" : "Pay Now"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {isExpanded ? "Hide" : "Details"}
                    </button>
                    <Link
                      to={`/earnings/reports?driverId=${encodeURIComponent(row.driver_id)}`}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Export
                    </Link>
                  </div>
                  {isExpanded && (
                    <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                      <p className="font-semibold text-slate-800">Breakdown</p>
                      <p>Gross: {formatCurrency(toNum(row.total_gross_earnings))}</p>
                      <p>Commission: {formatCurrency(toNum(row.company_commission))}</p>
                      <p>Raw net: {formatCurrency(toNum(row.raw_net_amount))}</p>
                      <p>Debt applied: {formatCurrency(toNum(row.debt_applied_amount))}</p>
                      <p className="font-semibold text-red-700">
                        Remaining debt: {formatCurrency(toNum(row.remaining_debt_amount))}
                      </p>
                      <p className="text-amber-800">Vehicle rental: {formatCurrency(toNum(row.vehicle_rental_fee))}</p>
                      <p className="mt-1 font-semibold text-slate-900">
                        Net payout: {formatCurrency(toNum(row.net_driver_payout))}
                      </p>
                      {detail?.rental_amount && (
                        <p className="mt-1 text-slate-600">
                          Rental contract: {formatCurrency(toNum(detail.rental_amount))}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      <ConfirmDialog
        open={payConfirm != null}
        onClose={() => !isPaying && setPayConfirm(null)}
        title={payConfirm?.kind === "many" ? "Pay multiple payouts?" : "Mark payout as paid?"}
        description={
          payConfirm?.kind === "one" && payConfirmRow ? (
            <p>
              You are about to record a payment of{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatCurrency(toNum(payConfirmRow.net_driver_payout))}
              </span>{" "}
              for{" "}
              <span className="font-semibold text-slate-900">
                {payConfirmRow.first_name} {payConfirmRow.last_name}
              </span>
              . This cannot be undone from here without admin support.
            </p>
          ) : payConfirm?.kind === "one" ? (
            <p className="text-amber-800">
              This payout is not visible in the current list; you can still confirm if you started payment from this
              page.
            </p>
          ) : payConfirm?.kind === "many" ? (
            <div className="space-y-2">
              <p>
                You are about to mark{" "}
                <span className="font-semibold text-slate-900">{payConfirm.ids.length}</span> pending payout
                {payConfirm.ids.length === 1 ? "" : "s"} as paid, for a combined total of{" "}
                <span className="font-semibold tabular-nums text-slate-900">
                  {formatCurrency(payConfirmBulkTotal)}
                </span>
                .
              </p>
              {payConfirmBulkTotal === 0 && payConfirm.ids.length > 0 && (
                <p className="text-xs text-amber-800">
                  Totals are based on rows visible in the current page response; verify amounts in the table before
                  confirming.
                </p>
              )}
            </div>
          ) : null
        }
        confirmLabel={payConfirm?.kind === "many" ? "Pay all selected" : "Confirm payment"}
        cancelLabel="Go back"
        confirmVariant="primary"
        isLoading={isPaying}
        onConfirm={handlePayConfirm}
      />
    </div>
  );
}
