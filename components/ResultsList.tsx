"use client";

import type { RankedRepo } from "@/lib/types";
import { RepoCard } from "./RepoCard";

interface Props {
  results: RankedRepo[];
  loading: boolean;
  // Indicates whether filters or just the empty list caused the empty state.
  filtersActive: boolean;
}

export function ResultsList({ results, loading, filtersActive }: Props) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink-700">No matching repositories.</p>
        <p className="mt-1 text-xs text-ink-500">
          {filtersActive
            ? "Try loosening the filters above, or rephrase your idea."
            : "Try a more specific idea, or include the kind of tool and tech stack you want."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {results.map((repo) => (
        <RepoCard key={repo.fullName} repo={repo} />
      ))}
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 space-y-2">
          <div className="shimmer h-4 w-1/3 rounded" />
          <div className="shimmer h-3 w-2/3 rounded" />
        </div>
        <div className="shimmer h-10 w-12 rounded-lg" />
      </div>
      <div className="mt-4 flex gap-3">
        <div className="shimmer h-3 w-16 rounded" />
        <div className="shimmer h-3 w-12 rounded" />
        <div className="shimmer h-3 w-20 rounded" />
      </div>
      <div className="mt-3 flex gap-2">
        <div className="shimmer h-5 w-14 rounded-full" />
        <div className="shimmer h-5 w-20 rounded-full" />
        <div className="shimmer h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}
