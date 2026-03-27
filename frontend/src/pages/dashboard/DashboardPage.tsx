import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import {
  getDashboardStats,
  getDriverStatusDistribution,
  getMonthlyEarnings,
  getDocumentStats,
  getRecentActivity,
} from "../../api/dashboard";
import type { DashboardActivityItem } from "../../api/dashboard";
import { AnalyticsCard } from "../../components/dashboard/AnalyticsCard";
import { ChartPlaceholder } from "../../components/dashboard/ChartPlaceholder";
import { ActivityTable, type ActivityRow } from "../../components/dashboard/ActivityTable";
import { DriverStatusChart } from "../../components/dashboard/DriverStatusChart";
import { EarningsChart } from "../../components/dashboard/EarningsChart";
import { DocumentStatsChart } from "../../components/dashboard/DocumentStatsChart";
import { formatCurrency } from "../../utils/currency";

const ACTIVITY_LABELS: Record<string, string> = {
  profile_update: "Profile updated",
  status_change: "Status changed",
  document_upload: "Document uploaded",
  document_verify: "Document verified",
  document_delete: "Document deleted",
  driver_delete: "Driver deleted",
  notes_update: "Notes updated",
};

function formatTime(createdAt: string): string {
  try {
    const d = new Date(createdAt);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return d.toLocaleDateString();
  } catch {
    return createdAt;
  }
}

function activityToRows(activities: DashboardActivityItem[]): ActivityRow[] {
  return activities.map((a) => ({
    id: a.id,
    description: ACTIVITY_LABELS[a.activity_type] ?? a.activity_type,
    meta: a.activity_description ?? undefined,
    time: formatTime(a.created_at),
    type: a.activity_type === "document_verify" ? "success" : "default",
  }));
}

// function ChartIcon() {
//   return (
//     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
//       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
//     </svg>
//   );
// }

function UsersIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function CurrencyIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function VehicleIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 13l2-5.5A2 2 0 017 6h10a2 2 0 011.87 1.3L21 13m-2 0h-2M5 13H3m2 0v4m12-4v4M7 17h2m6 0h2M7 17a2 2 0 01-2-2v-2m12 4a2 2 0 002-2v-2M7 17h6"
      />
    </svg>
  );
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  const statsQuery = useQuery({ queryKey: ["dashboard", "stats"], queryFn: () => getDashboardStats() });
  const statusQuery = useQuery({ queryKey: ["dashboard", "status"], queryFn: () => getDriverStatusDistribution() });
  const earningsQuery = useQuery({ queryKey: ["dashboard", "earnings"], queryFn: () => getMonthlyEarnings() });
  const docsQuery = useQuery({ queryKey: ["dashboard", "documents"], queryFn: () => getDocumentStats() });
  const activityQuery = useQuery({ queryKey: ["dashboard", "activity"], queryFn: () => getRecentActivity() });

  const stats = statsQuery.data?.data;
  const statusData = statusQuery.data?.data ?? [];
  const earningsData = earningsQuery.data?.data ?? [];
  const docsData = docsQuery.data?.data ?? [];
  const activities = activityQuery.data?.data ?? [];

  const isLoading = statsQuery.isLoading || statusQuery.isLoading;
  const isError = statsQuery.isError || statusQuery.isError;

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
          <p className="text-sm text-slate-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-center">
            <p className="text-red-600">Failed to load dashboard.</p>
            <Link to="/drivers" className="mt-2 inline-block text-sm text-sky-600 hover:underline">
            Go to drivers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
        <header className="shrink-0 border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">
                Welcome{user ? `, ${user.firstName}` : ""}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">{today}</p>
            </div>
            <Link
              to="/drivers"
              className="text-sm font-medium text-sky-600 hover:underline"
            >
              View all drivers →
            </Link>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Overview</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
              <Link to="/drivers" className="block rounded-xl hover:shadow-lg transition-shadow">
                <AnalyticsCard
                  title="Total drivers"
                  value={stats.totalDrivers}
                  icon={<UsersIcon />}
                />
              </Link>
              <Link to="/drivers" className="block rounded-xl hover:shadow-lg transition-shadow">
                <AnalyticsCard
                  title="Active drivers"
                  value={stats.activeDrivers}
                  trend={{ value: "vs last month", positive: true }}
                  icon={<UsersIcon />}
                />
              </Link>
              <AnalyticsCard
                title="Pending documents"
                value={stats.pendingDocuments}
                icon={<DocumentIcon />}
              />
              <AnalyticsCard
                title="Expired documents"
                value={stats.expiredDocuments}
                trend={{ value: "needs attention", positive: false }}
                icon={<DocumentIcon />}
              />
              <Link to="/vehicles" className="block rounded-xl hover:shadow-lg transition-shadow">
                <AnalyticsCard
                  title="Total vehicles"
                  value={stats.totalVehicles ?? 0}
                  icon={<VehicleIcon />}
                />
              </Link>
              <Link to="/vehicles" className="block rounded-xl hover:shadow-lg transition-shadow">
                <AnalyticsCard
                  title="Active rentals"
                  value={stats.activeRentals ?? 0}
                  icon={<VehicleIcon />}
                />
              </Link>
              <Link to="/rentals/overdue" className="block rounded-xl hover:shadow-lg transition-shadow">
                <AnalyticsCard
                  title="Overdue rentals"
                  value={stats.overdueRentals ?? 0}
                  trend={{ value: "needs attention", positive: false }}
                  icon={<VehicleIcon />}
                />
              </Link>
              <AnalyticsCard
                title="Commission earned"
                value={formatCurrency(stats.totalCommissionEarned ?? 0)}
                icon={<CurrencyIcon />}
              />
              <AnalyticsCard
                title="Pending payments"
                value={formatCurrency(stats.pendingPayments ?? 0)}
                icon={<CurrencyIcon />}
              />
            </div>
          </section>

          <section className="mb-8">
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Analytics</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Driver status</h3>
                <DriverStatusChart data={statusData} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Monthly earnings</h3>
                <EarningsChart data={earningsData} />
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-900 mb-3">Document verification</h3>
                <DocumentStatsChart data={docsData} />
              </div>
              <ChartPlaceholder title="Revenue by platform" height={240} />
            </div>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-slate-700 mb-4">Recent activity</h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <ActivityTable
                title="Activity feed"
                rows={activityToRows(activities)}
                emptyMessage="No recent activity."
              />
              <ChartPlaceholder title="Trips this week" height={320} />
            </div>
          </section>
        </div>
      </div>
  );
}
