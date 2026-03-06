import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

export interface DriverStatusItem {
  status: string;
  count: number;
}

const COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444"];

export function DriverStatusChart(props: { data: DriverStatusItem[] }) {
  const chartData = props.data.map((d) => ({ name: d.status, value: d.count }));
  const empty = chartData.every((d) => d.value === 0);
  if (empty) {
    return <div className="h-64 flex items-center justify-center text-slate-500 text-sm">No driver data</div>;
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={chartData} cx="50%" cy="50%" innerRadius={60} outerRadius={90} dataKey="value" nameKey="name">
          {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
