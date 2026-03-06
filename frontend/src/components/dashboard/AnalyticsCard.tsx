import type { ReactNode } from "react";

export interface AnalyticsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: { value: string; positive?: boolean };
  icon?: ReactNode;
  className?: string;
}

export function AnalyticsCard(props: AnalyticsCardProps) {
  const { title, value, subtitle, trend, icon, className = "" } = props;
  const trendPositive = trend?.positive !== false;

  return (
    <div
      className={
        "rounded-xl border border-slate-200 " +
        "bg-white p-5 shadow-sm transition-shadow hover:shadow-md " +
        className
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900 truncate">
            {value}
          </p>
          {subtitle && (
            <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
          )}
          {trend && (
            <span
              className={
                "mt-2 inline-flex items-center text-xs font-medium " +
                (trendPositive ? "text-emerald-600" : "text-red-600")
              }
            >
              {trend.value}
            </span>
          )}
        </div>
        {icon && (
          <div className="shrink-0 w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
