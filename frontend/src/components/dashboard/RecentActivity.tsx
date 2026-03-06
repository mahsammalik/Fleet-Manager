import type { DashboardActivityItem } from "../../api/dashboard";

const ACTIVITY_LABELS: Record<string, string> = {
  profile_update: "Profile updated",
  status_change: "Status changed",
  document_upload: "Document uploaded",
  document_verify: "Document verified",
  document_delete: "Document deleted",
  notes_update: "Notes updated",
};

function formatDate(createdAt: string): string {
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

export function RecentActivity({ activities }: { activities: DashboardActivityItem[] }) {
  if (!activities.length) {
    return (
      <p className="text-sm text-slate-500">No recent activity.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {activities.map((a) => (
        <li key={a.id} className="flex flex-wrap items-baseline gap-2 text-sm border-b border-slate-100 pb-2 last:border-0">
          <span className="font-medium text-slate-700">
            {ACTIVITY_LABELS[a.activity_type] ?? a.activity_type}
          </span>
          {a.activity_description && (
            <span className="text-slate-600 truncate max-w-[200px]">{a.activity_description}</span>
          )}
          <span className="text-xs text-slate-400 ml-auto shrink-0">{formatDate(a.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}
