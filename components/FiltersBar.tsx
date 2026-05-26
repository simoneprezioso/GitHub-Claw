"use client";

import type { SearchFilters, SortMode } from "@/lib/types";
import { cx } from "@/lib/utils";

interface Props {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  languages: string[];
  totalResults: number;
}

export function FiltersBar({ filters, onChange, languages, totalResults }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-ink-200 pb-3">
      <p className="text-sm font-medium text-ink-700">
        {totalResults} {totalResults === 1 ? "result" : "results"}
      </p>

      <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <SortGroup
          value={filters.sort}
          onChange={(sort) => onChange({ ...filters, sort })}
        />

        {languages.length > 0 && (
          <label className="flex items-center gap-1.5">
            <span className="text-ink-500">Language</span>
            <select
              value={filters.language ?? ""}
              onChange={(e) =>
                onChange({ ...filters, language: e.target.value || undefined })
              }
              className="rounded-md border border-ink-200 bg-white px-2 py-1 text-ink-900 focus:border-ink-900"
            >
              <option value="">Any</option>
              {languages.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}

        <Toggle
          label="Hide archived"
          checked={filters.hideArchived}
          onChange={(v) => onChange({ ...filters, hideArchived: v })}
        />
        <Toggle
          label="Hide forks"
          checked={filters.hideForks}
          onChange={(v) => onChange({ ...filters, hideForks: v })}
        />
        <Toggle
          label="Hide tutorials & lists"
          checked={filters.hideTutorials}
          onChange={(v) => onChange({ ...filters, hideTutorials: v })}
        />
      </div>
    </div>
  );
}

function SortGroup({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  const opts: Array<{ v: SortMode; label: string }> = [
    { v: "relevance", label: "Relevance" },
    { v: "stars", label: "Stars" },
    { v: "recent", label: "Recently updated" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded-md ring-1 ring-ink-200">
      {opts.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className={cx(
            "px-2.5 py-1 text-xs transition",
            i > 0 && "border-l border-ink-200",
            value === o.v
              ? "bg-ink-900 text-white"
              : "bg-white text-ink-700 hover:bg-ink-50",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-ink-600">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border-ink-300 text-ink-900 focus:ring-ink-900"
      />
      {label}
    </label>
  );
}
