interface StatsCardProps {
  title: string;
  value: string | number;
  icon?: React.ReactNode;
  color?: "slate" | "sky" | "green" | "amber" | "red" | "purple";
  trend?: string;
}

const colorClasses: Record<string, string> = {
  slate: "bg-slate-50 border-slate-200 text-slate-800",
  sky: "bg-sky-50 border-sky-200 text-sky-800",
  green: "bg-emerald-50 border-emerald-200 text-emerald-800",
  amber: "bg-amber-50 border-amber-200 text-amber-800",
  red: "bg-red-50 border-red-200 text-red-800",
  purple: "bg-purple-50 border-purple-200 text-purple-800",
};

export function StatsCard(props: StatsCardProps) {
  const { title, value, icon, color = "slate", trend } = props;
  const cls = colorClasses[color] ?? colorClasses.slate;
  return (
    <div className={"rounded-xl border p-4 " + cls}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium opacity-90">{title}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
          {trend && <p className="mt-0.5 text-xs opacity-80">{trend}</p>}
        </div>
        {icon && <div className="opacity-70">{icon}</div>}
      </div>
    </div>
  );
}
