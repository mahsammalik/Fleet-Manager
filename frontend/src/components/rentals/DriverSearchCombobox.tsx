import { useEffect, useId, useRef } from "react";
import type { DriverListItem } from "../../api/drivers";
import { useDriverCombobox } from "../../hooks/useDriverCombobox";

function formatDriverLabel(d: DriverListItem): string {
  return `${d.first_name} ${d.last_name} (${d.phone})`;
}

type DriverSearchComboboxProps = {
  value: DriverListItem | null;
  onChange: (driver: DriverListItem | null) => void;
  disabled?: boolean;
};

export function DriverSearchCombobox({
  value,
  onChange,
  disabled,
}: DriverSearchComboboxProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listboxId = `${baseId}-listbox`;
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    rootRef,
    open,
    setOpen,
    inputValue,
    setInputValue,
    highlightedIndex,
    setHighlightedIndex,
    results,
    isFetching,
    isError,
    refetch,
    moveHighlight,
    getHighlightedOrFirstDriver,
  } = useDriverCombobox();

  useEffect(() => {
    if (value) {
      setInputValue(formatDriverLabel(value));
    }
  }, [value?.id, value?.first_name, value?.last_name, value?.phone, setInputValue]);

  const handleInputChange = (next: string) => {
    setInputValue(next);
    if (value) onChange(null);
  };

  const selectDriver = (d: DriverListItem) => {
    onChange(d);
    setInputValue(formatDriverLabel(d));
    setOpen(false);
    inputRef.current?.blur();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      else moveHighlight(1);
      return;
    }

    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (open) moveHighlight(-1);
      return;
    }

    if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const pick = getHighlightedOrFirstDriver();
      if (pick) selectDriver(pick);
      else setOpen(false);
    }
  };

  const activeDescendantId =
    open && highlightedIndex >= 0 && results[highlightedIndex]
      ? `${listboxId}-opt-${highlightedIndex}`
      : undefined;

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700 mb-1">
        Driver *
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        autoComplete="off"
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-required
        aria-activedescendant={activeDescendantId}
        placeholder="Search by name, phone, or ID…"
        className="w-full rounded-xl border border-white/50 bg-white/70 px-3 py-2.5 text-sm text-slate-900 shadow-inner outline-none ring-sky-500/30 backdrop-blur-sm placeholder:text-slate-400 focus:border-sky-300/80 focus:ring-2"
        value={inputValue}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
      />

      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[55] cursor-default bg-slate-900/35 backdrop-blur-[1px] md:hidden"
            aria-label="Close driver list"
            onClick={() => setOpen(false)}
          />
          <ul
            id={listboxId}
            role="listbox"
            className="fixed inset-x-0 bottom-0 z-[60] max-h-[min(78vh,640px)] overflow-auto rounded-t-2xl border border-white/50 bg-white/90 py-1 shadow-2xl backdrop-blur-lg ring-1 ring-slate-900/5 md:absolute md:inset-x-auto md:bottom-auto md:left-0 md:right-0 md:top-full md:z-20 md:mt-1 md:max-h-60 md:rounded-xl"
          >
            <li
              role="presentation"
              className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/95 px-3 py-2 text-center text-xs font-medium text-slate-500 backdrop-blur-sm md:hidden"
            >
              Select a driver
            </li>
            {isFetching && (
              <li role="presentation" className="px-3 py-4 flex items-center justify-center gap-2 text-sm text-slate-500">
                <span
                  className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-slate-200 border-t-sky-600"
                  aria-hidden
                />
                Loading drivers…
              </li>
            )}
            {!isFetching && isError && (
              <li role="presentation" className="px-3 py-3 text-center text-sm text-red-600">
                Could not load drivers.{" "}
                <button type="button" className="font-medium text-sky-600 underline" onClick={() => refetch()}>
                  Retry
                </button>
              </li>
            )}
            {!isFetching && !isError && results.length === 0 && (
              <li role="presentation" className="px-3 py-4 text-center text-sm text-slate-500">
                No drivers match your search.
              </li>
            )}
            {!isFetching &&
              !isError &&
              results.map((d, i) => {
                const active = i === highlightedIndex;
                return (
                  <li
                    key={d.id}
                    id={`${listboxId}-opt-${i}`}
                    role="option"
                    aria-selected={value?.id === d.id}
                    className={`cursor-pointer px-3 py-2.5 text-sm ${
                      active ? "bg-sky-100/90 text-slate-900" : "text-slate-800 hover:bg-white/60"
                    }`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectDriver(d);
                    }}
                  >
                    <div className="font-medium">
                      {d.first_name} {d.last_name}
                    </div>
                    <div className="text-xs text-slate-500 tabular-nums">{d.phone}</div>
                  </li>
                );
              })}
          </ul>
        </>
      )}
    </div>
  );
}
