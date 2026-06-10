// The core search pipeline, independent of HTTP. One implementation reused by
// the Next.js API route, the CLI, and the MCP server, so every surface returns
// identical, grounded, API-verified results.
//
// Pipeline: expand → fan-out GitHub search → dedupe → rank the FULL pool →
//           README-enrich top N → optional embedding rerank.
//
// Note: this no longer pre-filters candidates by stars before ranking (the old
// route did, which deleted niche exact matches before the ranker ever saw
// them). We rank every deduped candidate — ranking is pure CPU over a small
// pool — and return a generous slice that the client filters/sorts locally.

import { expandQuery } from "./queryExpansion";
import { searchRepositories } from "./github";
import { rankRepos, enrichWithReadmes, sortRanked } from "./ranking";
import { fetchReadmes } from "./readme";
import { rerankWithEmbeddings, embeddingsEnabled } from "./embeddings";
import { withOutboundSlot } from "./limits";
import type { SearchResponse } from "./types";

const MAX_RETURNED = 50; // generous: the client filters/sorts this set with no re-fetch
const README_TOP_N = 5;

export interface PipelineOptions {
  token?: string;
  // Override embeddingsEnabled() (e.g. CLI --no-rerank).
  rerank?: boolean;
  readmeTopN?: number;
  maxReturned?: number;
}

export async function runSearchPipeline(
  query: string,
  opts: PipelineOptions = {},
): Promise<SearchResponse> {
  const expanded = expandQuery(query);
  const warnings: string[] = [];
  if (!opts.token) {
    warnings.push(
      "Running without a GitHub token — rate limit is 60 requests/hour per IP. Add a token for reliable results.",
    );
  }

  // GitHub search fan-out (concurrency-bounded so spikes can't wipe the quota).
  const searchResult = await withOutboundSlot(() =>
    searchRepositories(expanded.searchQueries, { token: opts.token }),
  );

  if (searchResult.failedQueries.length > 0) {
    warnings.push(
      `${searchResult.failedQueries.length} of ${expanded.searchQueries.length} sub-queries failed — results may be incomplete.`,
    );
  }

  // Rank the FULL deduped pool with permissive filters (no hiding) so the client
  // can toggle archived/forks/tutorials/language/sort locally. Slice AFTER rank.
  const permissive = {
    hideArchived: false,
    hideForks: false,
    hideTutorials: false,
    language: undefined,
    sort: "relevance" as const,
  };
  let ranked = rankRepos({
    repos: searchResult.candidates,
    expanded,
    filters: permissive,
  }).slice(0, opts.maxReturned ?? MAX_RETURNED);

  // README enrichment for the top N (grounds the explanation; small boost).
  const topN = opts.readmeTopN ?? README_TOP_N;
  const topNames = ranked.slice(0, topN).map((r) => r.fullName);
  const readmes = await withOutboundSlot(() =>
    fetchReadmes(topNames, { token: opts.token }),
  );
  ranked = enrichWithReadmes(ranked, expanded, readmes);
  if (readmes.size > 0) sortRanked(ranked, "relevance");

  // Optional embedding rerank (on by default; deterministic path is the floor).
  const doRerank = opts.rerank ?? embeddingsEnabled();
  let reranked = false;
  if (doRerank) {
    try {
      ranked = await rerankWithEmbeddings(query, ranked);
      reranked = true;
    } catch (err) {
      warnings.push(
        `Embedding reranker unavailable — using heuristic ranking. (${
          err instanceof Error ? err.message : "unknown"
        })`,
      );
    }
  }

  return {
    query: expanded.rawQuery,
    expandedQueries: expanded.searchQueries,
    results: ranked,
    meta: {
      candidateCount: searchResult.rawCount,
      dedupedCount: searchResult.candidates.length,
      rateLimitRemaining: searchResult.rateLimitRemaining,
      warnings,
      cached: false,
      reranked,
    },
  };
}
