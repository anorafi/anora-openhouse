import { useEffect, useRef, useState, type ReactNode } from "react";

export interface FilterSpec {
  label: string;
  value: string;
  /** "All" first, then only the values actually present in the data. */
  options: string[];
  onChange: (value: string) => void;
}

function Chevron() {
  return <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function FilterSelect({ filter }: { filter: FilterSpec }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return <div className="filter-select" ref={ref}>
    <button type="button" className="filter-current" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
      <span>{filter.label}</span>
      <strong>{filter.value}</strong>
      <span className="chev"><Chevron /></span>
    </button>
    {open && <div className="filter-menu" role="menu">
      {filter.options.map((option) => <button
        type="button"
        role="menuitemradio"
        aria-checked={option === filter.value}
        className={option === filter.value ? "selected" : ""}
        key={option}
        onClick={() => { filter.onChange(option); setOpen(false); }}
      >{option}</button>)}
    </div>}
  </div>;
}

/** Search plus a row of selects, shared by Markets and My facilities. */
export function FilterBar({ query, onQuery, placeholder, filters, trailing }: {
  query: string;
  onQuery: (value: string) => void;
  placeholder: string;
  filters: FilterSpec[];
  trailing?: ReactNode;
}) {
  return <div className="market-filters">
    <label className="market-search">
      <span aria-hidden="true">⌕</span>
      <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} />
    </label>
    <div className="filter-select-group">
      {filters.map((filter) => <FilterSelect filter={filter} key={filter.label} />)}
      {trailing}
    </div>
  </div>;
}

/** Keep only the values that appear in the data, in a stable display order. */
export function presentOptions<T>(items: T[], order: readonly string[], of: (item: T) => string) {
  return ["All", ...order.filter((value) => items.some((item) => of(item) === value))];
}
