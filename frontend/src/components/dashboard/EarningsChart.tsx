import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export interface MonthlyEarningsItem {
  month: string;
  totalEarnings?: number;
  totalCommission?: number;
}

export function EarningsChart(props: { data: MonthlyEarningsItem[] }) {
  const { data } = props;
  if (!data || data.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
        No earnings data yet
      </div>
    );
  }
  const chartData = data.map((d) => ({
    month: d.month,
    earnings: (d.totalEarnings ?? d.totalCommission ?? 0) as number,
  }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Line type="monotone" dataKey="earnings" stroke="#0ea5e9" strokeWidth={2} dot={{ r: 4 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}
