import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { LogoutButton } from "../UI/LogoutButton";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: DashboardIcon },
  { to: "/drivers", label: "Drivers", icon: DriversIcon },
  { to: "/vehicles", label: "Vehicles", icon: VehiclesIcon },
  { to: "/rentals/overdue", label: "Overdue rentals", icon: VehiclesIcon },
];

const earningsSubItems = [
  { to: "/earnings", label: "Overview" },
  { to: "/earnings/import", label: "Import" },
  { to: "/earnings/payouts", label: "Payouts" },
  { to: "/earnings/reports", label: "Reports" },
];

function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
    </svg>
  );
}

function DriversIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function AddIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function VehiclesIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-8 4h4m4 0h4m-4-4h4m-4-4h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 17h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  );
}

function EarningsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ChevronLeft({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRight({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const location = useLocation();
  const role = useAuthStore((s) => s.user?.role);
  const showEarnings = role === "admin" || role === "accountant";
  const [earningsOpen, setEarningsOpen] = useState(() => location.pathname.startsWith("/earnings"));

  useEffect(() => {
    if (location.pathname.startsWith("/earnings")) setEarningsOpen(true);
  }, [location.pathname]);

  const earningsActive = location.pathname.startsWith("/earnings");

  return (
    <aside
      className={`
        flex flex-col shrink-0 border-r border-slate-200
        bg-white
        transition-[width] duration-200 ease-out
        ${collapsed ? "w-[64px]" : "w-[240px]"}
      `}
    >
      <div className="flex h-14 items-center justify-between px-3 border-b border-slate-200 shrink-0">
        {!collapsed && (
          <Link to="/dashboard" className="font-semibold text-slate-900 truncate">
            Fleet Manager
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to || (to !== "/dashboard" && location.pathname.startsWith(to));
          return (
            <Link
              key={to}
              to={to}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]
                ${isActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}
              `}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}

        {showEarnings &&
          (collapsed ? (
            <Link
              to="/earnings"
              title="Earnings"
              className={`
                flex items-center justify-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px]
                ${earningsActive
                  ? "bg-slate-100 text-slate-900"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}
              `}
            >
              <EarningsIcon className="w-5 h-5 shrink-0" />
            </Link>
          ) : (
            <div className="rounded-lg">
              <button
                type="button"
                onClick={() => setEarningsOpen((o) => !o)}
                className={`
                  flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors min-h-[44px] text-left
                  ${earningsActive ? "bg-slate-100 text-slate-900" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"}
                `}
                aria-expanded={earningsOpen}
              >
                <EarningsIcon className="w-5 h-5 shrink-0" />
                <span className="flex-1 truncate">Earnings</span>
                <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${earningsOpen ? "rotate-180" : ""}`} />
              </button>
              {earningsOpen && (
                <div className="mt-0.5 ml-2 pl-3 border-l border-slate-200 space-y-0.5">
                  {earningsSubItems.map(({ to, label }) => {
                    const active = to === "/earnings" ? location.pathname === "/earnings" : location.pathname.startsWith(to);
                    return (
                      <Link
                        key={to}
                        to={to}
                        className={`
                          flex items-center px-3 py-2 rounded-md text-sm min-h-[40px]
                          ${active ? "bg-sky-50 text-sky-900 font-medium" : "text-slate-600 hover:bg-slate-50"}
                        `}
                      >
                        {label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
      </nav>

      <div className="p-2 border-t border-slate-200">
        <div className={collapsed ? "flex justify-center py-2" : "px-3 py-2"}>
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
