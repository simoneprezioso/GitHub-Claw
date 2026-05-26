// POST /api/search — the single endpoint the UI talks to.
// Pipeline: validate → cache → expand → fan-out → dedupe → rank → README →
//           optional embedding rerank → cache write → respond.

import { NextResponse } from "next/server";
import { expandQuery } from "@/lib/queryExpansion";
import { searchRepositories, GitHubError } from "@/lib/github";
import { rankRepos, enrichWithReadmes } from "@/lib/ranking";
import { fetchReadmes } from "@/lib/readme";
import {
  searchCacheKey,
  getCachedSearch,
  setCachedSearch,
} from "@/lib/cache";
import { rerankWithEmbeddings, embeddingsEnabled } from "@/lib/embeddings";
import type {
  SearchRequest,
  SearchResponse,
  SearchErrorResponse,
  SearchFilters,
} from "@/lib/types";

export const runtime = "nodejs";
// Don't cache the route itself — we run our own logic-aware cache that knows
// about TTLs and filter combinations.
export const dynamic = "force-dynamic";

const MAX_CANDIDATES = 75;
const MAX_RETURNED = 30;
const README_TOP_N = 5;

function normalizeFilters(input: Partial<SearchFilters> | undefined): SearchFilters {
  return {
    hideArchived: Boolean(input?.hideArchived ?? true),
    hideForks: Boolean(input?.hideForks ?? true),
    hideTutorials: Boolean(input?.hideTutorials ?? false),
    language: input?.language?.trim() || undefined,
    sort: (["relevance", "stars", "recent"] as const).includes(input?.sort as never)
      ? (input!.sort as SearchFilters["sort"])
      : "relevance",
  };
}

export async function POST(req: Request): Promise<Response> {
  let body: Partial<SearchRequest>;
  try {
    body = (await req.json()) as Partial<SearchRequest>;
  } catch {
    return json<SearchErrorResponse>({ error: "Invalid JSON in request body." }, 400);
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return json<SearchErrorResponse>({ error: "Query is required." }, 400);
  }
  if (query.length > 300) {
    return json<SearchErrorResponse>({ error: "Query is too long (max 300 chars)." }, 400);
  }

  const filters = normalizeFilters(body.filters);

  // ─── 1. Cache check ────────────────────────────────────────────────────
  const cacheKey = searchCacheKey(query, filters);
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return json<SearchResponse>(
      { ...cached, meta: { ...cached.meta, cached: true } },
      200,
    );
  }

  const expanded = expandQuery(query);
  const token = process.env.GITHUB_TOKEN || undefined;
  const warnings: string[] = [];
  if (!token) {
    warnings.push(
      "Running without GITHUB_TOKEN — rate limit is 60 req/hour per IP. Add a token to .env.local for reliable results.",
    );
  }

  // ─── 2. GitHub search ──────────────────────────────────────────────────
  let searchResult;
  try {
    searchResult = await searchRepositories(expanded.searchQueries, { token });
  } catch (err) {
    if (err instanceof GitHubError) {
      const status = err.rateLimited ? 429 : err.status >= 400 ? err.status : 502;
      return json<SearchErrorResponse>(
        {
          error: err.rateLimited
            ? "GitHub rate limit reached."
            : `GitHub API error: ${err.message}`,
          hint: err.rateLimited
            ? token
              ? "Wait a few minutes — your token's hourly window will reset soon."
              : "Add a GITHUB_TOKEN to your .env.local to raise the rate limit from 60/hour to 5000/hour."
            : undefined,
          rateLimitRemaining: err.rateLimitRemaining,
        },
        status,
      );
    }
    return json<SearchErrorResponse>(
      { error: err instanceof Error ? err.message : "Unknown error reaching GitHub." },
      502,
    );
  }

  if (searchResult.failedQueries.length > 0) {
    warnings.push(
      `${searchResult.failedQueries.length} of ${expanded.searchQueries.length} sub-queries failed — results may be incomplete.`,
    );
  }

  const candidates = searchResult.candidates
    .slice()
    .sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0))
    .slice(0, MAX_CANDIDATES);

  // ─── 3. Heuristic ranking ──────────────────────────────────────────────
  let ranked = rankRepos({ repos: candidates, expanded, filters }).slice(0, MAX_RETURNED);

  // ─── 4. README enrichment (top N only) ────────────────────────────────
  const topNames = ranked.slice(0, README_TOP_N).map((r) => r.fullName);
  const readmes = await fetchReadmes(topNames, { token });
  ranked = enrichWithReadmes(ranked, expanded, readmes);

  // Re-sort if the README boost shifted the order. We only need to re-sort
  // the top portion that could have moved.
  if (filters.sort === "relevance" && readmes.size > 0) {
    ranked.sort((a, b) => b.score - a.score || b.stars - a.stars);
  }

  // ─── 5. Optional embedding rerank ─────────────────────────────────────
  if (embeddingsEnabled()) {
    try {
      ranked = await rerankWithEmbeddings(query, ranked);
    } catch (err) {
      warnings.push(
        `Embedding reranker failed — falling back to heuristic ranking. (${err instanceof Error ? err.message : "unknown"})`,
      );
    }
  }

  const payload: SearchResponse = {
    query: expanded.rawQuery,
    expandedQueries: expanded.searchQueries,
    results: ranked,
    meta: {
      candidateCount: searchResult.candidates.length,
      dedupedCount: candidates.length,
      rateLimitRemaining: searchResult.rateLimitRemaining,
      warnings,
      cached: false,
    },
  };

  // ─── 6. Cache write ────────────────────────────────────────────────────
  setCachedSearch(cacheKey, payload);

  return json(payload, 200);
}

export async function GET(): Promise<Response> {
  return json<SearchErrorResponse>(
    { error: "Use POST /api/search with { query, filters } in the body." },
    405,
  );
}

function json<T>(payload: T, status: number): Response {
  return NextResponse.json(payload, { status });
}
