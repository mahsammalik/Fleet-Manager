import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

export interface DocumentStatsItem {
  documentType: string;
  total: number;
  verified: number;
  pending: number;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  id_card: "ID Card",
  drivers_license: "License",
  contract: "Contract",
  insurance: "Insurance",
  vehicle_permit: "Permit",
  other: "Other",
};

export function DocumentStatsChart({ data }: { data: DocumentStatsItem[] }) {
  const chartData = data.map((d) => ({
    name: DOC_TYPE_LABELS[d.documentType] ?? d.documentType,
    verified: d.verified,
    pending: d.pending,
    total: d.total,
  }));
  if (chartData.every((d) => d.total === 0)) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500 text-sm">
        No document data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="verified" fill="#10b981" name="Verified" stackId="a" radius={[0, 0, 0, 0]} />
        <Bar dataKey="pending" fill="#f59e0b" name="Pending" stackId="a" radius={[0, 0, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
