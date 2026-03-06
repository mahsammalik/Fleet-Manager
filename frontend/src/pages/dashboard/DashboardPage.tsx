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
import { StatsCard } from "../../components/dashboard/StatsCard";
import { DriverStatusChart } from "../../components/dashboard/DriverStatusChart";
import { EarningsChart } from "../../components/dashboard/EarningsChart";
import { DocumentStatsChart } from "../../components/dashboard/DocumentStatsChart";
import { RecentActivity } from "../../components/dashboard/RecentActivity";
import { QuickActions } from "../../components/dashboard/QuickActions";
import { LogoutButton } from "../../components/UI/LogoutButton";

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

  const quickActions = [
    { label: "Add New Driver", to: "/drivers/new" },
    { label: "View Drivers", to: "/drivers" },
    { label: "View Reports", onClick: () => {} },
    { label: "Export Data", onClick: () => {} },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="inline-block w-8 h-8 border-2 border-sky-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (isError || !stats) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-red-600">Failed to load dashboard.</p>
        <Link to="/drivers" className="ml-2 text-sky-600 hover:underline">Go to drivers</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">
            Welcome{user ? ", " + user.firstName : ""}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">{today}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/drivers" className="text-sm text-slate-600 hover:text-slate-900">View all drivers</Link>
          <LogoutButton />
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Quick actions</h2>
          <QuickActions actions={quickActions} />
        </section>

        <section>
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Overview</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
            <StatsCard title="Total Drivers" value={stats.totalDrivers} color="sky" />
            <StatsCard title="Active Drivers" value={stats.activeDrivers} color="green" />
            <StatsCard title="Pending Documents" value={stats.pendingDocuments} color="amber" />
            <StatsCard title="Expired Documents" value={stats.expiredDocuments} color="red" />
            <StatsCard title="Commission Earned" value={"$" + (stats.totalCommissionEarned ?? 0)} color="purple" />
            <StatsCard title="Pending Payments" value={stats.pendingPayments} color="slate" />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Driver status</h3>
            <DriverStatusChart data={statusData} />
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Monthly earnings</h3>
            <EarningsChart data={earningsData} />
          </div>
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Document verification</h3>
            <DocumentStatsChart data={docsData} />
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Recent activity</h3>
            <RecentActivity activities={activities} />
          </div>
        </section>
      </main>
    </div>
  );
}
