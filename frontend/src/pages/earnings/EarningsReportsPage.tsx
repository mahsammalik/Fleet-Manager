import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import Papa from "papaparse";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useAuthStore } from "../../store/authStore";
import { getEarningsReports } from "../../api/earnings";
import type { EarningsReportRow } from "../../api/earnings";
import { EarningsReportsPreviewTable } from "../../components/earnings/EarningsReportsPreviewTable";
import { formatCurrency } from "../../utils/currency";

function errMessage(e: unknown): string {
  if (axios.isAxiosError(e)) {
    const m = e.response?.data as { message?: string } | undefined;
    if (typeof e.response?.data === "string" && e.response.data.length < 200) return e.response.data;
    if (m?.message) return m.message;
    return e.message;
  }
  return e instanceof Error ? e.message : "Export failed";
}

export function EarningsReportsPage() {
  const user = useAuthStore((s) => s.user);
  const [searchParams, setSearchParams] = useSearchParams();
  const driverIdFromUrl =
    searchParams.get("driverId")?.trim() || searchParams.get("driver_id")?.trim() || undefined;

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [minVehicleRental, setMinVehicleRental] = useState("");
  const [csvBusy, setCsvBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState<EarningsReportRow[]>([]);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const query = useQuery({
    queryKey: ["earnings", "reports", from, to, q, status, driverIdFromUrl, minVehicleRental],
    queryFn: () =>
      getEarningsReports({
        from: from || undefined,
        to: to || undefined,
        q: q.trim() || undefined,
        status: status || undefined,
        driverId: driverIdFromUrl,
        minVehicleRental: minVehicleRental.trim() ? Number(minVehicleRental) : undefined,
      }).then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  const rows = query.data?.items ?? [];
  const summary = query.data?.summary;

  async function exportCsv() {
    setCsvBusy(true);
    setError(null);
    try {
      const sourceRows = visibleRows.length > 0 ? visibleRows : rows;
      if (sourceRows.length === 0) {
        setError("No rows to export.");
        return;
      }
      const csv = Papa.unparse(
        sourceRows.map((r) => ({
          driver: r.driver_name,
          period: `${r.period_start_label} - ${r.period_end_label}`,
          total_revenue: r.total_gross_earnings ?? "",
          vehicle_rental: r.vehicle_rental_fee ?? "",
          net_payout: r.net_driver_payout ?? "",
          status: r.payment_status,
        })),
      );
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "earnings-reports-preview.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setCsvBusy(false);
    }
  }

  async function exportPdf() {
    setPdfBusy(true);
    setError(null);
    try {
      if (!previewRef.current) {
        setError("Preview section is not ready yet.");
        return;
      }
      const canvas = await html2canvas(previewRef.current, {
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
      pdf.save("earnings-reports-preview.pdf");
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPdfBusy(false);
    }
  }

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Filter first, preview live, then download confidently.</p>
      </header>

      <div className="flex-1 p-4 sm:p-6 w-full space-y-6">
        {error && <div className="rounded-lg bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>}

        {driverIdFromUrl && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-2 text-sm text-sky-900">
            <span>Showing reports for one driver from URL filter.</span>
            <button
              type="button"
              className="text-sky-700 font-medium hover:underline"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                next.delete("driverId");
                next.delete("driver_id");
                setSearchParams(next);
              }}
            >
              Clear driver filter
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[340px_1fr] gap-4">
          <aside className="rounded-2xl border border-white/30 bg-white/60 backdrop-blur-md shadow-lg p-5 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Period from</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Period to</label>
                <input
                  type="date"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">All</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="hold">Hold</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Driver search</label>
                <input
                  type="search"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  placeholder="Name or phone"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Vehicle rental &gt; X</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-[44px]"
                  placeholder="0.00"
                  value={minVehicleRental}
                  onChange={(e) => setMinVehicleRental(e.target.value)}
                />
              </div>
            </div>
            <button
              type="button"
              className="w-full rounded-lg border border-slate-300 text-slate-700 text-sm font-medium py-2.5 min-h-[44px] hover:bg-slate-50"
              onClick={() => {
                setFrom("");
                setTo("");
                setQ("");
                setStatus("");
                setMinVehicleRental("");
              }}
            >
              Reset filters
            </button>
          </aside>

          <section className="space-y-4">
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={csvBusy || query.isLoading}
                onClick={() => void exportCsv()}
                className="rounded-lg bg-sky-600 text-white text-sm font-medium px-4 py-2.5 min-h-[44px] hover:bg-sky-700 disabled:opacity-50"
              >
                {csvBusy ? "Preparing CSV..." : "Download CSV"}
              </button>
              <button
                type="button"
                disabled={pdfBusy || query.isLoading}
                onClick={() => void exportPdf()}
                className="rounded-lg bg-slate-900 text-white text-sm font-medium px-4 py-2.5 min-h-[44px] hover:bg-slate-800 disabled:opacity-50"
              >
                {pdfBusy ? "Rendering PDF..." : "Download PDF"}
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-500">Total payout</p>
                <p className="mt-1 text-base font-semibold text-slate-900">
                  {summary ? formatCurrency(summary.totalNetPayout) : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-500">Rows</p>
                <p className="mt-1 text-base font-semibold text-slate-900">
                  {summary ? summary.rowCount.toLocaleString() : "—"}
                </p>
              </div>
              <div className="rounded-xl border border-white/40 bg-white/70 px-4 py-3 shadow-sm">
                <p className="text-xs text-slate-500">Vehicle rental total</p>
                <p className="mt-1 text-base font-semibold text-slate-900">
                  {summary ? formatCurrency(summary.totalVehicleRental) : "—"}
                </p>
              </div>
            </div>

            {query.data?.truncated && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Showing first {query.data.limit.toLocaleString()} rows in preview due to report limit.
              </div>
            )}

            <div ref={previewRef} className="rounded-2xl border border-white/30 bg-white/60 backdrop-blur-md shadow-lg p-4">
              <EarningsReportsPreviewTable
                rows={rows}
                loading={query.isLoading}
                onVisibleRowsChange={setVisibleRows}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
