"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SearchBox } from "@/components/SearchBox";
import { ResultsList } from "@/components/ResultsList";
import { FiltersBar } from "@/components/FiltersBar";
import { TokenSettings } from "@/components/TokenSettings";
import { applyClientFilters, uniqueLanguages } from "@/lib/ranking";
import type {
  SearchFilters,
  SortMode,
  SearchResponse,
  SearchErrorResponse,
  MaintenanceVerdict,
} from "@/lib/types";
import { cx } from "@/lib/utils";

const EXAMPLES = [
  "self-hosted Typeform alternative built with React",
  "tool that converts PDFs into structured JSON",
  "open-source local-first Notion clone",
  "CLI that records terminal sessions as GIFs",
  "AI browser agent framework with Playwright",
];

const TOKEN_STORAGE_KEY = "claw_gh_token";

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState(initial.query);
  const [filters, setFilters] = useState<SearchFilters>(initial.filters);
  const [state, setState] = useState<SearchState>(INITIAL_STATE);
  const [copied, setCopied] = useState(false);
  const [userToken, setUserToken] = useState<string | null>(null);

  // Load any saved per-user token once on mount. We read localStorage in an
  // effect (not a lazy initializer) so the SSR and first client render agree —
  // the token affects rendered text, so a lazy initializer would mismatch.
  useEffect(() => {
    try {
      const t = window.localStorage.getItem(TOKEN_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- canonical post-mount localStorage read
      if (t) setUserToken(t);
    } catch {
      /* private mode / blocked storage — ignore */
    }
  }, []);

  const handleTokenChange = useCallback((t: string | null) => {
    setUserToken(t);
    try {
      if (t) window.localStorage.setItem(TOKEN_STORAGE_KEY, t);
      else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Push current query+filters to the URL without adding a history entry.
  const syncUrl = useCallback(
    (query: string, f: SearchFilters) => {
      const qs = filtersToParams(query, f).toString();
      const path = qs ? `/?${qs}` : "/";
      router.replace(path, { scroll: false });
    },
    [router],
  );

  // A search hits the network. Filter/sort changes do NOT — they're applied
  // client-side over the already-fetched result set (see displayedResults).
  const runSearch = useCallback(
    async (queryArg: string, filtersArg: SearchFilters) => {
      const query = queryArg.trim();
      if (!query) return;
      syncUrl(query, filtersArg);
      setState((s) => ({ ...s, query, loading: true, error: null }));
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (userToken) headers["x-github-token"] = userToken;
        const res = await fetch("/api/search", {
          method: "POST",
          headers,
          body: JSON.stringify({ query }),
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
    [syncUrl, userToken],
  );

  // Auto-run an initial search if the URL had a `q`.
  const didAutoRun = useRef(false);
  useEffect(() => {
    if (didAutoRun.current) return;
    didAutoRun.current = true;
    if (initial.query) {
      const id = setTimeout(() => runSearch(initial.query, initial.filters), 0);
      return () => clearTimeout(id);
    }
  }, [initial.query, initial.filters, runSearch]);

  // Filter/sort changes are now FREE — just update state + URL, no re-fetch.
  const handleFilterChange = (next: SearchFilters) => {
    setFilters(next);
    syncUrl(state.query || input, next);
  };

  const handleSubmit = () => runSearch(input, filters);

  const handleExample = (ex: string) => {
    setInput(ex);
    runSearch(ex, filters);
  };

  const handleCopyLink = async () => {
    // Build the link from current state rather than window.location, which can
    // lag router.replace by a tick.
    const qs = filtersToParams(state.query || input, filters).toString();
    const url = `${window.location.origin}/${qs ? `?${qs}` : ""}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link", url);
    }
  };

  const allResults = useMemo(() => state.data?.results ?? [], [state.data]);
  const displayedResults = useMemo(
    () => applyClientFilters(allResults, filters),
    [allResults, filters],
  );
  const languages = useMemo(() => uniqueLanguages(allResults), [allResults]);
  const verdictCounts = useMemo(() => countVerdicts(displayedResults), [displayedResults]);

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
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
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
          <TokenSettings token={userToken} onChange={handleTokenChange} />
        </section>
      )}

      {hasResults && (
        <section className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Searching for</p>
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

          {state.data && displayedResults.length > 0 && (
            <VerdictSummary counts={verdictCounts} reranked={state.data.meta.reranked ?? false} />
          )}

          {(state.data || state.loading) && !state.error && (
            <FiltersBar
              filters={filters}
              onChange={handleFilterChange}
              languages={languages}
              totalResults={displayedResults.length}
            />
          )}

          {/* aria-live region so screen readers hear results / loading / empty changes. */}
          <div aria-live="polite" aria-busy={state.loading}>
            {!state.error && (
              <ResultsList
                results={displayedResults}
                loading={state.loading}
                filtersActive={filtersActive}
              />
            )}
          </div>

          {state.data && (
            <MetaFooter
              candidates={state.data.meta.candidateCount}
              shown={displayedResults.length}
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

function countVerdicts(results: { maintenance: { verdict: MaintenanceVerdict } }[]) {
  const counts: Record<MaintenanceVerdict, number> = { Adopt: 0, Risky: 0, Abandoned: 0 };
  for (const r of results) counts[r.maintenance.verdict]++;
  return counts;
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
            Real open-source projects for your idea: verified, never invented.
          </p>
          <p className="mx-auto max-w-xl text-sm text-ink-500">
            Describe a tool in plain English. Every result is a live GitHub repository
            pulled straight from the API, with a transparent match score and an honest
            <span className="font-medium text-ink-700"> Adopt / Risky / Abandoned </span>
            verdict. No hallucinated repos, no dead links.
          </p>
        </>
      )}
    </header>
  );
}

function VerdictSummary({
  counts,
  reranked,
}: {
  counts: Record<MaintenanceVerdict, number>;
  reranked: boolean;
}) {
  const items: Array<[MaintenanceVerdict, string]> = [
    ["Adopt", "bg-emerald-50 text-emerald-700 ring-emerald-200"],
    ["Risky", "bg-amber-50 text-amber-700 ring-amber-200"],
    ["Abandoned", "bg-ink-100 text-ink-500 ring-ink-200"],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {items.map(([v, cls]) =>
        counts[v] > 0 ? (
          <span key={v} className={cx("rounded-full px-2 py-0.5 font-medium ring-1", cls)}>
            {counts[v]} {v}
          </span>
        ) : null,
      )}
      {reranked && (
        <span
          className="rounded-full bg-sky-50 px-2 py-0.5 font-medium text-sky-700 ring-1 ring-sky-200"
          title="Results were re-ordered by a local semantic (embedding) reranker on top of the heuristic score."
        >
          semantic rerank
        </span>
      )}
    </div>
  );
}

function ErrorPanel({ error }: { error: SearchErrorResponse }) {
  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p className="font-medium">{error.error}</p>
      {error.hint && <p className="mt-1 text-red-700/90">{error.hint}</p>}
      {typeof error.rateLimitRemaining === "number" && (
        <p className="mt-2 text-xs text-red-700/80">
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
  shown,
  deduped,
  rateLimit,
  cached,
}: {
  candidates: number;
  shown: number;
  deduped: number;
  rateLimit: number | null;
  cached: boolean;
}) {
  return (
    <p className="pt-2 text-center text-[11px] text-ink-500">
      Scanned {candidates} results · showing {shown} of {deduped} unique repos
      {typeof rateLimit === "number" && ` · ${rateLimit} GitHub API calls left this hour`}
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
    <footer className="mt-auto pt-8 text-center text-[11px] text-ink-500">
      <p>
        Built on the GitHub REST API. Not affiliated with GitHub. Every repo shown is
        real and was live when fetched; scoring and verdicts are heuristic. See the
        README for details.
      </p>
    </footer>
  );
}
