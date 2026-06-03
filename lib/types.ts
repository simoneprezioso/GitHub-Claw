// Shared types used across the API route, ranking, and UI.

export type SortMode = "relevance" | "stars" | "recent";

export interface SearchFilters {
  hideArchived: boolean;
  hideForks: boolean;
  hideTutorials: boolean;
  language?: string;
  sort: SortMode;
}

export interface SearchRequest {
  query: string;
  filters: SearchFilters;
}

// Subset of the GitHub /search/repositories response we actually use.
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  language: string | null;
  license: { spdx_id: string | null; name: string } | null;
  topics?: string[];
  homepage: string | null;
  pushed_at: string;
  updated_at: string;
  archived: boolean;
  fork: boolean;
  open_issues_count: number;
  default_branch: string;
  owner: { login: string; avatar_url: string };
}

export interface ScoreBreakdown {
  textRelevance: number;
  popularity: number;
  freshness: number;
  health: number;
  penalty: number;
  // Optional: only populated when README enrichment ran for this repo.
  readme?: number;
  // Optional: only populated when ENABLE_EMBEDDING_RERANK=1.
  embedding?: number;
}

export type HealthBadge =
  | "Active"
  | "Popular"
  | "Recently updated"
  | "Stale"
  | "Archived"
  | "Fork"
  | "Possible tutorial"
  | "Awesome list"
  | "No license"
  | "Has demo";

// Headline maintenance triage — the "can I rely on this?" verdict. This is the
// product's core differentiator vs. hallucination-prone LLM recommendations:
// every verdict is derived from live, fetched GitHub metadata, never invented.
export type MaintenanceVerdict = "Adopt" | "Risky" | "Abandoned";

export interface Maintenance {
  verdict: MaintenanceVerdict;
  // Short, human-readable, evidence-grounded reasons for the verdict.
  reasons: string[];
}

export interface RankedRepo {
  fullName: string;
  name: string;
  owner: string;
  ownerAvatar: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  license: string | null;
  topics: string[];
  homepage: string | null;
  pushedAt: string;
  updatedAt: string;
  archived: boolean;
  fork: boolean;
  openIssues: number;
  score: number;
  // Fractional, unclamped score used only for sort tie-breaking so that two
  // repos that round to the same integer `score` (or both clamp to 0) still
  // order by their true relative quality instead of falling through to stars.
  rawScore: number;
  scoreBreakdown: ScoreBreakdown;
  // Live-metadata maintenance verdict (Adopt / Risky / Abandoned).
  maintenance: Maintenance;
  badges: HealthBadge[];
  warnings: string[];
  whyMatched: string;
  // Truncated README text shown in the UI. Present only for top-N candidates
  // we deemed worth fetching (see search route).
  readmeExcerpt?: string;
  // Query/expansion terms that *also* appeared in the README. Used by
  // `whyMatched` to ground the explanation in readme content.
  readmeMatched?: string[];
}

export interface SearchMeta {
  // Total raw results across all sub-queries, before dedupe.
  candidateCount: number;
  // Unique repositories after dedupe — the full pool the ranker scored.
  dedupedCount: number;
  rateLimitRemaining: number | null;
  warnings: string[];
  // True when the response was served entirely from the cache (no GitHub calls).
  cached?: boolean;
  // True when the optional embedding reranker contributed to this response.
  reranked?: boolean;
}

export interface SearchResponse {
  query: string;
  expandedQueries: string[];
  results: RankedRepo[];
  meta: SearchMeta;
}

export interface SearchErrorResponse {
  error: string;
  hint?: string;
  rateLimitRemaining?: number | null;
}
