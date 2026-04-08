import { useState } from "react";
import axios from "axios";
import { useAuthStore } from "../../store/authStore";
import { downloadEarningsReportCsv } from "../../api/earnings";

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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function exportCsv() {
    setBusy(true);
    setError(null);
    try {
      const res = await downloadEarningsReportCsv({
        from: from || undefined,
        to: to || undefined,
        q: q.trim() || undefined,
        status: status || undefined,
      });
      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "earnings-payouts-report.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access.</p>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Reports</h1>
        <p className="text-sm text-slate-500 mt-1">Export payout rows as CSV with optional filters.</p>
      </header>

      <div className="flex-1 p-4 sm:p-6 max-w-lg mx-auto w-full space-y-6">
        {error && <div className="rounded-lg bg-red-50 text-red-800 text-sm px-3 py-2">{error}</div>}

        <div className="rounded-2xl border border-white/30 bg-white/60 backdrop-blur-md shadow-lg p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportCsv()}
            className="w-full rounded-lg bg-sky-600 text-white text-sm font-medium py-3 min-h-[48px] hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? "Preparing…" : "Download CSV"}
          </button>
        </div>
      </div>
    </div>
  );
}
