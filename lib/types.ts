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
  scoreBreakdown: ScoreBreakdown;
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
  candidateCount: number;
  dedupedCount: number;
  rateLimitRemaining: number | null;
  warnings: string[];
  // True when the response was served entirely from the cache (no GitHub calls).
  cached?: boolean;
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
