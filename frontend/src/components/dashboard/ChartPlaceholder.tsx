export interface ChartPlaceholderProps {
  title?: string;
  height?: number;
  className?: string;
}

export function ChartPlaceholder({ title = "Chart", height = 280, className = "" }: ChartPlaceholderProps) {
  return (
    <div
      className={`
        rounded-xl border border-slate-200
        bg-white
        overflow-hidden shadow-sm
        ${className}
      `}
    >
      {title && (
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        </div>
      )}
      <div
        className="flex items-center justify-center bg-slate-50"
        style={{ height }}
      >
        <div className="text-center text-slate-400">
          <svg
            className="mx-auto w-12 h-12 mb-2 opacity-50"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z"
            />
          </svg>
          <p className="text-sm font-medium">Chart placeholder</p>
          <p className="text-xs mt-0.5">Connect your data source</p>
        </div>
      </div>
    </div>
  );
}
