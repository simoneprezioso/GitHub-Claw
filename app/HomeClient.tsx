"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchBox } from "@/components/SearchBox";
import { ResultsList } from "@/components/ResultsList";
import { FiltersBar } from "@/components/FiltersBar";
import { uniqueLanguages } from "@/lib/ranking";
import type {
  SearchFilters,
  SortMode,
  SearchResponse,
  SearchErrorResponse,
} from "@/lib/types";
import { cx } from "@/lib/utils";

const EXAMPLES = [
  "self-hosted Typeform alternative built with React",
  "tool that converts PDFs into structured JSON",
  "open-source local-first Notion clone",
  "CLI that records terminal sessions as GIFs",
  "AI browser agent framework with Playwright",
];

const DEFAULT_FILTERS: SearchFilters = {
  hideArchived: true,
  hideForks: true,
  hideTutorials: false,
  language: undefined,
  sort: "relevance",
};

const SORT_VALUES: SortMode[] = ["relevance", "stars", "recent"];

// URL ↔ filters serialization. We only put non-default values in the URL so
// the shareable link stays as short as possible.
function filtersToParams(query: string, f: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (f.sort !== DEFAULT_FILTERS.sort) params.set("sort", f.sort);
  if (f.language) params.set("lang", f.language);
  // Toggles: serialize only when they differ from the default.
  if (f.hideArchived !== DEFAULT_FILTERS.hideArchived) {
    params.set("archived", f.hideArchived ? "0" : "1");
  }
  if (f.hideForks !== DEFAULT_FILTERS.hideForks) {
    params.set("forks", f.hideForks ? "0" : "1");
  }
  if (f.hideTutorials !== DEFAULT_FILTERS.hideTutorials) {
    params.set("tutorials", f.hideTutorials ? "0" : "1");
  }
  return params;
}

function parseFilters(sp: URLSearchParams): { query: string; filters: SearchFilters } {
  const query = sp.get("q") ?? "";
  const sortRaw = sp.get("sort");
  const sort: SortMode = SORT_VALUES.includes(sortRaw as SortMode)
    ? (sortRaw as SortMode)
    : DEFAULT_FILTERS.sort;
  const filters: SearchFilters = {
    hideArchived: sp.get("archived") === "1" ? false : DEFAULT_FILTERS.hideArchived,
    hideForks: sp.get("forks") === "1" ? false : DEFAULT_FILTERS.hideForks,
    hideTutorials: sp.get("tutorials") === "1" ? true : DEFAULT_FILTERS.hideTutorials,
    language: sp.get("lang") || undefined,
    sort,
  };
  return { query, filters };
}

interface SearchState {
  query: string;
  loading: boolean;
  data: SearchResponse | null;
  error: SearchErrorResponse | null;
}

const INITIAL_STATE: SearchState = {
  query: "",
  loading: false,
  data: null,
  error: null,
};

export function HomeClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Initial hydration from URL — runs once.
  const initial = useMemo(() => {
    const parsed = parseFilters(new URLSearchParams(searchParams.toString()));
    return parsed;
    // We intentionally do NOT depend on searchParams here; subsequent URL
    // changes are driven by user actions and re-fired through runSearch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState(initial.query);
  const [filters, setFilters] = useState<SearchFilters>(initial.filters);
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const [copied, setCopied] = useState(false);

  // Push current query+filters to the URL without adding a history entry.
  const syncUrl = useCallback(
    (query: string, f: SearchFilters) => {
      const qs = filtersToParams(query, f).toString();
      const path = qs ? `/?${qs}` : "/";
      router.replace(path, { scroll: false });
    },
    [router],
  );

  const runSearch = useCallback(
    async (queryArg: string, filtersArg: SearchFilters) => {
      const query = queryArg.trim();
      if (!query) return;
      syncUrl(query, filtersArg);
      setState((s) => ({ ...s, query, loading: true, error: null }));
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, filters: filtersArg }),
        });
        const json = (await res.json()) as SearchResponse | SearchErrorResponse;
        if (!res.ok) {
          setState({ query, loading: false, data: null, error: json as SearchErrorResponse });
          return;
        }
        setState({ query, loading: false, data: json as SearchResponse, error: null });
      } catch (err) {
        setState({
          query,
          loading: false,
          data: null,
          error: { error: err instanceof Error ? err.message : "Network error" },
        });
      }
    },
    [syncUrl],
  );

  // Auto-run an initial search if the URL had a `q`. We defer to a microtask
  // so React doesn't see a synchronous setState during effect commit (which
  // newer react-hooks lint rules — correctly — flag as cascading renders).
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    if (initial.query) {
      const id = setTimeout(() => runSearch(initial.query, initial.filters), 0);
      return () => clearTimeout(id);
    }
  }, [initial.query, initial.filters, runSearch]);

  const handleFilterChange = (next: SearchFilters) => {
    setFilters(next);
    if (state.query) runSearch(state.query, next);
    else syncUrl(input, next); // keep URL in sync even before first search
  };

  const handleSubmit = () => runSearch(input, filters);

  const handleExample = (ex: string) => {
    setInput(ex);
    runSearch(ex, filters);
  };

  const handleCopyLink = async () => {
    const url = new URL(window.location.href);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Older browsers / non-secure contexts: fall back to selecting the URL bar.
      window.prompt("Copy this link", url.toString());
    }
  };

  const languages = useMemo(
    () => (state.data ? uniqueLanguages(state.data.results) : []),
    [state.data],
  );

  const filtersActive =
    filters.hideArchived ||
    filters.hideForks ||
    filters.hideTutorials ||
    Boolean(filters.language);

  const hasResults = Boolean(state.data || state.loading || state.error);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-4 py-10 sm:py-16">
      <Header compact={hasResults} />

      <SearchBox
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        loading={state.loading}
        autoFocus
        compact={hasResults}
      />

      {!hasResults && (
        <section aria-label="Example searches" className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
            Try an example
          </p>
          <ul className="flex flex-wrap gap-2">
            {EXAMPLES.map((ex) => (
              <li key={ex}>
                <button
                  onClick={() => handleExample(ex)}
                  className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-700 transition hover:border-ink-900 hover:text-ink-900"
                >
                  {ex}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasResults && (
        <section className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-400">Searching for</p>
                <p className="break-words text-sm text-ink-900">“{state.query}”</p>
              </div>
              {state.data && (
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="shrink-0 rounded-md border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-700 transition hover:border-ink-900 hover:text-ink-900"
                >
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
              )}
            </div>
            {state.data && state.data.expandedQueries.length > 0 && (
              <details className="text-xs text-ink-500">
                <summary className="cursor-pointer hover:text-ink-900">
                  How this was searched ({state.data.expandedQueries.length} sub-queries)
                </summary>
                <ul className="mt-2 space-y-1 pl-3">
                  {state.data.expandedQueries.map((q) => (
                    <li key={q} className="font-mono text-[11px] text-ink-600">
                      {q}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {state.error && <ErrorPanel error={state.error} />}

          {state.data && state.data.meta.warnings.length > 0 && (
            <WarningsPanel warnings={state.data.meta.warnings} />
          )}

          {(state.data || state.loading) && !state.error && (
            <FiltersBar
              filters={filters}
              onChange={handleFilterChange}
              languages={languages}
              totalResults={state.data?.results.length ?? 0}
            />
          )}

          {!state.error && (
            <ResultsList
              results={state.data?.results ?? []}
              loading={state.loading}
              filtersActive={filtersActive}
            />
          )}

          {state.data && (
            <MetaFooter
              candidates={state.data.meta.candidateCount}
              deduped={state.data.meta.dedupedCount}
              rateLimit={state.data.meta.rateLimitRemaining}
              cached={state.data.meta.cached ?? false}
            />
          )}
        </section>
      )}

      <FooterCredit />
    </main>
  );
}

function Header({ compact }: { compact: boolean }) {
  return (
    <header className={cx("space-y-3 text-center", compact ? "" : "pt-4")}>
      <div className="flex items-center justify-center gap-2">
        <span aria-hidden className="text-2xl">🐙</span>
        <h1 className="text-xl font-semibold tracking-tight text-ink-900">GitHub Claw</h1>
      </div>
      {!compact && (
        <>
          <p className="mx-auto max-w-xl text-2xl font-semibold tracking-tight text-ink-900 sm:text-3xl">
            Find open-source projects from an idea, not keywords.
          </p>
          <p className="mx-auto max-w-xl text-sm text-ink-500">
            Describe a tool, app, library, or project in plain English. GitHub Claw
            expands your idea into search queries and ranks real repositories by
            relevance, popularity, freshness, and health.
          </p>
        </>
      )}
    </header>
  );
}

function ErrorPanel({ error }: { error: SearchErrorResponse }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{error.error}</p>
      {error.hint && <p className="mt-1 text-red-700/80">{error.hint}</p>}
      {typeof error.rateLimitRemaining === "number" && (
        <p className="mt-2 text-xs text-red-700/70">
          Rate limit remaining: {error.rateLimitRemaining}
        </p>
      )}
    </div>
  );
}

function WarningsPanel({ warnings }: { warnings: string[] }) {
  return (
    <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
      {warnings.map((w) => (
        <li key={w}>{w}</li>
      ))}
    </ul>
  );
}

function MetaFooter({
  candidates,
  deduped,
  rateLimit,
  cached,
}: {
  candidates: number;
  deduped: number;
  rateLimit: number | null;
  cached: boolean;
}) {
  return (
    <p className="pt-2 text-center text-[11px] text-ink-400">
      Fetched {candidates} candidates, ranked top {deduped}
      {typeof rateLimit === "number" && ` · ${rateLimit} GitHub API calls remaining this hour`}
      {cached && (
        <>
          {" · "}
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-ink-600 ring-1 ring-ink-200">
            cached
          </span>
        </>
      )}
    </p>
  );
}

function FooterCredit() {
  return (
    <footer className="mt-auto pt-8 text-center text-[11px] text-ink-400">
      <p>
        Built on the GitHub REST API. Not affiliated with GitHub. Ranking is
        heuristic — see README for details.
      </p>
    </footer>
  );
}
