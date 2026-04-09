import { useState } from "react";

type TooltipProps = {
  content: string;
  className?: string;
  align?: "left" | "right" | "center";
};

export function Tooltip({ content, className = "", align = "left" }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const alignClass =
    align === "right"
      ? "right-0"
      : align === "center"
        ? "left-1/2 -translate-x-1/2"
        : "left-0";

  return (
    <span className={`relative inline-flex items-center group ${className}`}>
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-500 hover:text-slate-700 hover:border-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
        aria-label="Show explanation"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      <span
        className={[
          "pointer-events-none absolute z-30 top-full mt-2 w-[min(260px,80vw)] rounded-md border border-slate-200 bg-slate-900 px-2.5 py-2 text-[11px] leading-relaxed text-white shadow-xl",
          "opacity-0 translate-y-1 transition duration-150",
          "group-hover:opacity-100 group-hover:translate-y-0",
          "group-focus-within:opacity-100 group-focus-within:translate-y-0",
          open ? "opacity-100 translate-y-0" : "",
          alignClass,
        ].join(" ")}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}
