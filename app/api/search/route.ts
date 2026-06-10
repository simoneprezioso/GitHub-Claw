// POST /api/search — the single endpoint the UI talks to.
// Pipeline: rate-limit → validate → cache → coalesce → runSearchPipeline →
//           cache write → respond. The heavy lifting lives in lib/searchPipeline
//           so the CLI and MCP server share the exact same logic.

import { NextResponse } from "next/server";
import { GitHubError } from "@/lib/github";
import { runSearchPipeline } from "@/lib/searchPipeline";
import { searchCacheKey, getCachedSearch, setCachedSearch } from "@/lib/cache";
import { rateLimit, coalesce, clientIp } from "@/lib/limits";
import type {
  SearchRequest,
  SearchResponse,
  SearchErrorResponse,
} from "@/lib/types";

export const runtime = "nodejs";
// Don't cache the route itself — we run our own logic-aware cache that knows
// about TTLs.
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // ─── 1. Per-IP rate limit (runs on every request, even cache hits, so an
  //        attacker can't bypass it by varying the query to force a miss) ────
  const rl = rateLimit(clientIp(req));
  if (!rl.allowed) {
    const retryAfter = Math.ceil(rl.retryAfterMs / 1000);
    return NextResponse.json(
      {
        error: "Too many requests. Slow down.",
        hint: `Try again in about ${retryAfter}s.`,
      } satisfies SearchErrorResponse,
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

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

  // Per-user token (sent via header so it never lands in URLs/logs/body). Falls
  // back to the server's token. Lets a user lift their own rate limit without
  // the server operator sharing one PAT across everyone.
  //
  // SECURITY: this value is a user secret. It must only ever be forwarded to the
  // GitHub API (lib/github, lib/readme). Never log it, echo it in an error
  // response, or persist it — the UI promises exactly that to the user.
  const token = req.headers.get("x-github-token")?.trim() || process.env.GITHUB_TOKEN || undefined;

  // ─── 2. Cache check (query-only key: results no longer depend on filters,
  //        which are applied client-side) ─────────────────────────────────────
  const cacheKey = searchCacheKey(query);
  const cached = getCachedSearch(cacheKey);
  if (cached) {
    return json<SearchResponse>(
      {
        ...cached,
        // Scrub volatile fields — a cached entry can be up to an hour old, so its
        // frozen rate-limit number and "no token" warning would be misleading.
        meta: { ...cached.meta, cached: true, rateLimitRemaining: null, warnings: [] },
      },
      200,
    );
  }

  // ─── 3. Run the pipeline (coalesced so a thundering herd of identical queries
  //        shares one upstream fan-out instead of multiplying GitHub spend) ────
  let payload: SearchResponse;
  try {
    payload = await coalesce(cacheKey, () => runSearchPipeline(query, { token }));
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
              ? "Wait a few minutes; your token's hourly window will reset soon."
              : "Add a GITHUB_TOKEN (or paste your own token in the UI) to raise the rate limit from 60/hour to 5000/hour."
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

  // ─── 4. Cache write ──────────────────────────────────────────────────────
  setCachedSearch(cacheKey, payload);

  return json(payload, 200);
}

export async function GET(): Promise<Response> {
  return json<SearchErrorResponse>(
    { error: "Use POST /api/search with { query } in the body." },
    405,
  );
}

function json<T>(payload: T, status: number): Response {
  return NextResponse.json(payload, { status });
}
