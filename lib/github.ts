// Thin wrapper around the GitHub /search/repositories endpoint.
// Concerns: auth, rate-limit propagation, error normalisation, dedupe.

import type { GitHubRepo } from "./types";

const SEARCH_URL = "https://api.github.com/search/repositories";
const PER_PAGE = 30; // GitHub max is 100, but 30 keeps each call cheap.

export interface GitHubSearchResult {
  candidates: GitHubRepo[];
  rateLimitRemaining: number | null;
  // Queries that errored out — surfaced to the UI so we can show a soft warning.
  failedQueries: { query: string; status: number; message: string }[];
  // Set to true if we saw a 401/403 with rate-limit zero or auth failure.
  rateLimited: boolean;
}

interface SearchEnv {
  token?: string;
  // Optional fetch override for tests.
  fetchImpl?: typeof fetch;
}

export class GitHubError extends Error {
  status: number;
  rateLimitRemaining: number | null;
  rateLimited: boolean;
  constructor(message: string, status: number, opts: { rateLimitRemaining?: number | null; rateLimited?: boolean } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.rateLimitRemaining = opts.rateLimitRemaining ?? null;
    this.rateLimited = opts.rateLimited ?? false;
  }
}

async function searchOnce(
  query: string,
  env: SearchEnv,
): Promise<{ items: GitHubRepo[]; rateLimitRemaining: number | null }> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-claw-mvp",
  };
  if (env.token) headers.Authorization = `Bearer ${env.token}`;

  // We always include the "topics" mediatype implicitly via the new API
  // version; the repository_search response now includes `topics` by default.
  const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&per_page=${PER_PAGE}&sort=best-match`;
  const fetchImpl = env.fetchImpl ?? fetch;

  const res = await fetchImpl(url, { headers, cache: "no-store" });
  const rateLimitRemainingHeader = res.headers.get("x-ratelimit-remaining");
  const rateLimitRemaining = rateLimitRemainingHeader ? Number(rateLimitRemainingHeader) : null;

  if (!res.ok) {
    // Distinguish rate-limit from other errors. GitHub returns 403 with
    // x-ratelimit-remaining: 0 when you're throttled.
    const rateLimited = res.status === 403 && rateLimitRemaining === 0;
    const body = await safeJson(res);
    const message = (body && typeof body === "object" && "message" in body && typeof body.message === "string")
      ? body.message
      : `GitHub request failed (${res.status})`;
    throw new GitHubError(message, res.status, { rateLimitRemaining, rateLimited });
  }

  const data = (await res.json()) as { items?: GitHubRepo[] };
  return { items: data.items ?? [], rateLimitRemaining };
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

// Run a small set of search queries in parallel, dedupe by full_name,
// and degrade gracefully if some sub-queries fail.
export async function searchRepositories(
  queries: string[],
  env: SearchEnv = {},
): Promise<GitHubSearchResult> {
  const results = await Promise.allSettled(queries.map((q) => searchOnce(q, env)));

  const byFullName = new Map<string, GitHubRepo>();
  const failed: GitHubSearchResult["failedQueries"] = [];
  let minRemaining: number | null = null;
  let rateLimited = false;

  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      for (const repo of r.value.items) {
        if (!repo.full_name) continue;
        if (!byFullName.has(repo.full_name)) {
          byFullName.set(repo.full_name, repo);
        }
      }
      const remaining = r.value.rateLimitRemaining;
      if (remaining !== null) {
        minRemaining = minRemaining === null ? remaining : Math.min(minRemaining, remaining);
      }
    } else {
      const err = r.reason;
      if (err instanceof GitHubError) {
        failed.push({ query: queries[idx], status: err.status, message: err.message });
        if (err.rateLimited) rateLimited = true;
        if (err.rateLimitRemaining !== null) {
          minRemaining = minRemaining === null ? err.rateLimitRemaining : Math.min(minRemaining, err.rateLimitRemaining);
        }
      } else {
        failed.push({
          query: queries[idx],
          status: 0,
          message: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  });

  // If *every* query failed, propagate the first error so the API route can
  // return a useful status code instead of an empty list.
  if (failed.length === queries.length && queries.length > 0) {
    const first = failed[0];
    throw new GitHubError(first.message, first.status || 502, {
      rateLimitRemaining: minRemaining,
      rateLimited,
    });
  }

  return {
    candidates: Array.from(byFullName.values()),
    rateLimitRemaining: minRemaining,
    failedQueries: failed,
    rateLimited,
  };
}
