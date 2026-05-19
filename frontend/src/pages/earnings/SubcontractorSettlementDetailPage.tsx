import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import Papa from "papaparse";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useAuthStore } from "../../store/authStore";
import {
  bulkUpdateSubcontractorPayouts,
  getSubcontractorSettlementDetail,
  type SubcontractorSettlementDetailDriver,
} from "../../api/subcontractorPayouts";
import { formatCurrency } from "../../utils/currency";

function sumDrivers(rows: SubcontractorSettlementDetailDriver[], key: keyof SubcontractorSettlementDetailDriver) {
  return rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
}

function statusBadgeClass(status: string) {
  switch (status) {
    case "paid":
      return "bg-emerald-100 text-emerald-800";
    case "pending":
      return "bg-amber-100 text-amber-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
}

export function SubcontractorSettlementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const q = useQuery({
    queryKey: ["subcontractor-settlement-detail", id],
    queryFn: () => getSubcontractorSettlementDetail(id!).then((r) => r.data),
    enabled: (user?.role === "admin" || user?.role === "accountant") && !!id,
  });

  const payMut = useMutation({
    mutationFn: () => bulkUpdateSubcontractorPayouts({ ids: [id!], paymentStatus: "paid" }),
    onSuccess: () => {
      setMsg("Marked as paid.");
      void qc.invalidateQueries({ queryKey: ["subcontractor-settlement-detail", id] });
      void qc.invalidateQueries({ queryKey: ["earnings", "subcontractor-settlements"] });
    },
    onError: () => setMsg("Mark paid failed."),
  });

  async function exportCsv() {
    if (!q.data) return;
    setCsvBusy(true);
    try {
      const { settlement, drivers } = q.data;
      const csv = Papa.unparse(
        drivers.map((d) => ({
          driver: d.name,
          gross_incl_tips: d.gross,
          tips: d.tips,
          commission: d.commission,
          vehicle_rent: d.vehicle_rent,
          account_opening_fee: d.account_opening_fee,
          platform_fees: d.platform_fees,
          daily_cash: d.daily_cash,
          net: d.net,
        })),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `settlement-${settlement.subcontractor_name.replace(/\s+/g, "-")}-${settlement.period_start}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setCsvBusy(false);
    }
  }

  async function exportPdf() {
    if (!printRef.current || !q.data) return;
    setPdfBusy(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      const fittedHeight = Math.min(pdfHeight, pdf.internal.pageSize.getHeight() - 10);
      pdf.addImage(imgData, "PNG", 5, 5, pdfWidth - 10, fittedHeight);
      pdf.save(
        `settlement-${q.data.settlement.subcontractor_name.replace(/\s+/g, "-")}-${q.data.settlement.period_start}.pdf`,
      );
    } finally {
      setPdfBusy(false);
    }
  }

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  if (q.isLoading) return <p className="p-6 text-sm text-slate-500">Loading settlement…</p>;
  if (q.isError || !q.data) {
    return (
      <div className="p-6">
        <p className="text-sm text-red-700">Failed to load settlement detail.</p>
        <Link to="/earnings/subcontractors/settlements" className="text-sm text-sky-700 hover:underline mt-2 inline-block">
          Back to settlements
        </Link>
      </div>
    );
  }

  const { settlement, totals, drivers, validation } = q.data;
  const integrityOk = validation.matched && validation.totals_matched;
  const canPay = settlement.status !== "paid";

  const footer = {
    gross: sumDrivers(drivers, "gross"),
    tips: sumDrivers(drivers, "tips"),
    commission: sumDrivers(drivers, "commission"),
    vehicle_rent: sumDrivers(drivers, "vehicle_rent"),
    account_opening_fee: sumDrivers(drivers, "account_opening_fee"),
    platform_fees: sumDrivers(drivers, "platform_fees"),
    daily_cash: sumDrivers(drivers, "daily_cash"),
    net: sumDrivers(drivers, "net"),
  };

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              to="/earnings/subcontractors/settlements"
              className="text-sm text-sky-700 hover:underline"
            >
              Subcontractor settlements
            </Link>
            <h1 className="text-lg font-semibold text-slate-900 mt-1">{settlement.subcontractor_name}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {settlement.period_start} → {settlement.period_end}
            </p>
            <span
              className={`inline-block mt-2 rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusBadgeClass(settlement.status)}`}
            >
              {settlement.status}
            </span>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500 uppercase tracking-wide">Payable</p>
            <p className="text-2xl font-semibold text-slate-900 tabular-nums">
              {formatCurrency(Number(settlement.payable))}
            </p>
            {settlement.paid_amount != null && settlement.status === "paid" && (
              <p className="text-xs text-slate-500 mt-1">
                Paid {formatCurrency(Number(settlement.paid_amount))}
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button
            type="button"
            disabled={csvBusy}
            onClick={() => void exportCsv()}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {csvBusy ? "Exporting…" : "Export CSV"}
          </button>
          <button
            type="button"
            disabled={pdfBusy}
            onClick={() => void exportPdf()}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
          >
            {pdfBusy ? "Exporting…" : "Export PDF"}
          </button>
          {canPay && (
            <button
              type="button"
              disabled={payMut.isPending}
              onClick={() => payMut.mutate()}
              className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {payMut.isPending ? "Paying…" : "Mark as paid"}
            </button>
          )}
        </div>
        {msg && <p className="text-sm text-slate-700 mt-2">{msg}</p>}
      </header>

      <div ref={printRef} className="p-4 sm:p-6 space-y-4">
        {integrityOk ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Data integrity: driver breakdown matches settlement totals.
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            Data integrity error: driver totals do not match the settlement.
            {validation.matched === false && (
              <span className="block mt-1">
                Net sum difference: {formatCurrency(validation.difference)} (expected 0).
              </span>
            )}
            {validation.totals_matched === false && (
              <span className="block mt-1">
                Column totals difference (max): {formatCurrency(validation.totals_difference)}.
              </span>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: "Drivers", value: String(totals.drivers) },
            { label: "Gross incl. tips", value: formatCurrency(Number(totals.gross_incl_tips)) },
            { label: "Tips", value: formatCurrency(Number(totals.tips)) },
            { label: "Commission", value: formatCurrency(Number(totals.commission)) },
            { label: "Vehicle rent", value: formatCurrency(Number(totals.vehicle_rent)) },
            { label: "Acct. fee", value: formatCurrency(Number(totals.account_opening_fee)) },
            { label: "Platform fee", value: formatCurrency(Number(totals.platform_fees)) },
            { label: "Daily cash", value: formatCurrency(Number(totals.daily_cash)) },
            { label: "Payable", value: formatCurrency(Number(totals.payable)) },
          ].map((c) => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className="text-sm font-semibold text-slate-900 tabular-nums mt-1">{c.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-left">
              <tr>
                <th className="px-3 py-2">Driver</th>
                <th
                  className="px-3 py-2 text-right"
                  title="Sum of driver gross earnings (income + tips). Tips column is separate."
                >
                  Gross incl. tips
                </th>
                <th className="px-3 py-2 text-right">Tips</th>
                <th className="px-3 py-2 text-right">Commission</th>
                <th className="px-3 py-2 text-right">Vehicle rent</th>
                <th className="px-3 py-2 text-right">Acct. fee</th>
                <th className="px-3 py-2 text-right">Platform fee</th>
                <th className="px-3 py-2 text-right">Daily cash</th>
                <th className="px-3 py-2 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {drivers.map((d) => (
                <tr key={d.id}>
                  <td className="px-3 py-2 font-medium text-slate-900">{d.name || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(d.gross))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(d.tips))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(d.commission))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(Number(d.vehicle_rent))}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(d.account_opening_fee))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(d.platform_fees))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {formatCurrency(Number(d.daily_cash))}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{formatCurrency(Number(d.net))}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50 font-semibold text-slate-900 border-t border-slate-200">
              <tr>
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.gross)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.tips)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.commission)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.vehicle_rent)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.account_opening_fee)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.platform_fees)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.daily_cash)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(footer.net)}</td>
              </tr>
            </tfoot>
          </table>
          {drivers.length === 0 && (
            <p className="text-sm text-slate-500 p-4">
              No driver payouts linked to this settlement. Run Refresh settlements on the list page.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
