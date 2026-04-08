import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../store/authStore";
import { getEarningsOverview, getPayoutIntegrityRows } from "../../api/earnings";
import { DriverPayoutTable } from "../../components/dashboard/DriverPayoutTable";
import { formatCurrency } from "../../utils/currency";

function DonutRing(props: {
  pct: number;
  label: string;
  caption: string;
  color: string;
}) {
  const p = Math.min(100, Math.max(0, props.pct));
  const angle = (p / 100) * 360;
  const bg =
    p <= 0
      ? "#e2e8f0"
      : p >= 100
        ? props.color
        : `conic-gradient(${props.color} 0deg ${angle}deg, #e2e8f0 ${angle}deg 360deg)`;

  return (
    <div className="flex flex-col items-center">
      <div
        className="relative w-28 h-28 sm:w-32 sm:h-32 rounded-full p-[10px] shadow-inner"
        style={{ background: bg }}
        aria-label={`${props.label}: ${p.toFixed(0)} percent`}
      >
        <div className="w-full h-full rounded-full bg-slate-50 flex items-center justify-center shadow-sm">
          <div className="text-center px-1">
            <div className="text-lg font-bold text-slate-900">{p.toFixed(0)}%</div>
            <div className="text-[10px] text-slate-500 leading-tight">{props.label}</div>
          </div>
        </div>
      </div>
      <p className="text-xs text-slate-500 mt-2 text-center max-w-[140px]">{props.caption}</p>
    </div>
  );
}

export function EarningsOverviewPage() {
  const user = useAuthStore((s) => s.user);
  const overviewQuery = useQuery({
    queryKey: ["earnings", "overview"],
    queryFn: () => getEarningsOverview().then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });
  const integrityQuery = useQuery({
    queryKey: ["earnings", "payout-integrity"],
    queryFn: () => getPayoutIntegrityRows().then((r) => r.data),
    enabled: user?.role === "admin" || user?.role === "accountant",
  });

  if (user?.role !== "admin" && user?.role !== "accountant") {
    return <p className="p-6 text-slate-600">You do not have access to earnings.</p>;
  }

  if (overviewQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="inline-block h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (overviewQuery.isError || !overviewQuery.data) {
    return <p className="p-6 text-red-600">Could not load earnings overview.</p>;
  }

  const { kpis, monthly } = overviewQuery.data;
  const totalGross = monthly.reduce((s, m) => s + m.totalEarnings, 0);
  const totalComm = monthly.reduce((s, m) => s + m.totalCommission, 0);
  const base = totalGross + totalComm;
  const commPct = base > 0 ? (totalComm / base) * 100 : 0;

  const pending = kpis.pendingPaymentsTotal;
  const denom = pending + kpis.totalEarningsLast30Days;
  const pendingSharePct = denom > 0 ? Math.min(100, (pending / denom) * 100) : 0;

  const maxBar = Math.max(1, ...monthly.map((m) => m.totalEarnings));

  const cardClass =
    "rounded-2xl border border-white/30 bg-white/60 backdrop-blur-md shadow-[0_8px_30px_rgb(0,0,0,0.06)] p-4 sm:p-5";

  return (
    <div className="flex flex-col flex-1 overflow-auto">
      <header className="shrink-0 border-b border-slate-200 bg-white/80 backdrop-blur-md px-4 sm:px-6 py-4">
        <h1 className="text-lg font-semibold text-slate-900">Earnings overview</h1>
        <p className="text-sm text-slate-500 mt-1">KPIs and composition (CSS charts only).</p>
      </header>

      <div className="flex-1 p-4 sm:p-6 space-y-8">
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className={cardClass}>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Pending payouts</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {formatCurrency(kpis.pendingPaymentsTotal)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Gross (30 days)</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {formatCurrency(kpis.totalEarningsLast30Days)}
            </p>
          </div>
          <div className={cardClass}>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Avg paid payout (90d)</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1 tabular-nums">
              {formatCurrency(kpis.avgPayoutPaidLast90Days)}
            </p>
          </div>
        </section>

        <section className={`${cardClass} flex flex-col sm:flex-row flex-wrap gap-8 justify-around items-center`}>
          <DonutRing
            pct={commPct}
            label="Commission"
            caption="Share of commission + gross (all months in chart)"
            color="#0ea5e9"
          />
          <DonutRing
            pct={pendingSharePct}
            label="Pending"
            caption="Pending payouts vs pending + 30d gross (illustrative)"
            color="#f59e0b"
          />
        </section>

        <section className={cardClass}>
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Monthly gross (bars)</h2>
          <div className="flex items-end gap-1 sm:gap-2 h-40 border-b border-slate-200 pb-1 overflow-x-auto px-1">
            {monthly.length === 0 ? (
              <p className="text-sm text-slate-500">No monthly data yet.</p>
            ) : (
              monthly.map((m) => {
                const barPx = m.totalEarnings > 0 ? Math.max(6, (m.totalEarnings / maxBar) * 120) : 0;
                return (
                  <div key={m.month} className="flex flex-col items-center min-w-[36px] flex-1 h-full justify-end">
                    <div
                      className="w-full max-w-[48px] rounded-t-md bg-gradient-to-t from-sky-600 to-sky-400 mx-auto"
                      style={{ height: barPx }}
                      title={`${m.month}: ${formatCurrency(m.totalEarnings)}`}
                    />
                    <span className="text-[10px] text-slate-500 mt-1 truncate max-w-full">{m.month}</span>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section>
          <DriverPayoutTable rows={integrityQuery.data ?? []} />
        </section>
      </div>
    </div>
  );
}
