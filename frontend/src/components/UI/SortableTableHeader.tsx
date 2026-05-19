import type { SortOrder } from "../../hooks/useListSort";

type SortableTableHeaderProps = {
  label: string;
  sortBy?: string;
  active: boolean;
  order?: SortOrder;
  onSort: () => void;
  className?: string;
};

export function SortableTableHeader({
  label,
  active,
  order,
  onSort,
  className = "",
}: SortableTableHeaderProps) {
  const ariaSort = active ? (order === "asc" ? "ascending" : "descending") : "none";

  return (
    <th className={`px-3 py-2 text-left font-medium text-slate-700 ${className}`.trim()}>
      <button
        type="button"
        onClick={onSort}
        aria-sort={ariaSort}
        className="inline-flex items-center gap-1 rounded-md px-0.5 py-0.5 text-left font-medium text-slate-700 hover:bg-slate-200/60 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/40"
      >
        <span>{label}</span>
        {active && order === "asc" && (
          <span className="text-[10px] leading-none text-sky-600" aria-hidden>
            ▲
          </span>
        )}
        {active && order === "desc" && (
          <span className="text-[10px] leading-none text-sky-600" aria-hidden>
            ▼
          </span>
        )}
      </button>
    </th>
  );
}
