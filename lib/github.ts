// Thin wrapper around the GitHub /search/repositories endpoint.
// Concerns: auth, rate-limit propagation, error normalisation, dedupe.

import type { GitHubRepo } from "./types";

const SEARCH_URL = "https://api.github.com/search/repositories";
// GitHub's Search API costs exactly ONE rate-limit unit per request regardless
// of per_page (1–100), so a smaller page is NOT cheaper — it only lowers recall.
// We fetch the max so the candidate pool actually fills before dedupe.
const PER_PAGE = 100;
const SEARCH_TIMEOUT_MS = 8000; // mirror readme.ts so a hung connection can't hang the request

export interface GitHubSearchResult {
  candidates: GitHubRepo[];
  // Total items returned across all sub-queries before dedupe (recall signal).
  rawCount: number;
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

  // Guard every call with a timeout — without this a single hung connection
  // hangs the whole /api/search request up to the platform function timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, cache: "no-store", signal: ctrl.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new GitHubError("GitHub search timed out.", 504);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rateLimitRemainingHeader = res.headers.get("x-ratelimit-remaining");
  const rateLimitRemaining = rateLimitRemainingHeader ? Number(rateLimitRemainingHeader) : null;

  if (!res.ok) {
    const body = await safeJson(res);
    const message = (body && typeof body === "object" && "message" in body && typeof body.message === "string")
      ? body.message
      : `GitHub request failed (${res.status})`;
    // Distinguish throttling from other errors. GitHub returns 403/429 with
    // x-ratelimit-remaining: 0 for the primary limit, and a 403 whose body
    // mentions a "secondary rate limit"/"abuse" (often with Retry-After) for
    // the secondary limit. Treat both as rate-limited.
    const rateLimited =
      (res.status === 403 || res.status === 429) &&
      (rateLimitRemaining === 0 ||
        res.headers.has("retry-after") ||
        /secondary rate limit|abuse/i.test(message));
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
  let rawCount = 0;

  results.forEach((r, idx) => {
    if (r.status === "fulfilled") {
      rawCount += r.value.items.length;
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
    rawCount,
    rateLimitRemaining: minRemaining,
    failedQueries: failed,
    rateLimited,
  };
}
