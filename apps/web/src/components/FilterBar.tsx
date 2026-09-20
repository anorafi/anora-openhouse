import type { ReactNode } from "react";

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
      {filters.map((filter) => <label className="filter-select" key={filter.label}>
        <span>{filter.label}</span>
        <select aria-label={filter.label} value={filter.value} onChange={(event) => filter.onChange(event.target.value)}>
          {filter.options.map((option) => <option key={option}>{option}</option>)}
        </select>
        <span className="chev"><Chevron /></span>
      </label>)}
      {trailing}
    </div>
  </div>;
}

/** Keep only the values that appear in the data, in a stable display order. */
export function presentOptions<T>(items: T[], order: readonly string[], of: (item: T) => string) {
  return ["All", ...order.filter((value) => items.some((item) => of(item) === value))];
}
