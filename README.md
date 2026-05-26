# GitHub Claw 🐙

> Find open-source projects from an idea, not keywords.

GitHub Claw is a small web app that turns a vague project description into a ranked list of real, relevant GitHub repositories. You type something fuzzy like *"self-hosted Typeform alternative built with React"* — it expands the idea into multiple targeted GitHub search queries, dedupes the candidates, scores them on relevance + popularity + freshness + health, and returns a clean ranked list with badges, warnings, and an explanation for each match.

It's a search engine, not a chatbot. No accounts, no billing, no LLM APIs.

---

## Features

- **Plain-English search** — describe a tool, app, library, or project in your own words.
- **Deterministic query expansion** — ~55 hand-curated categories (forms, notion-likes, terminal recorders, kanban, mesh VPN, vector DBs, …), alt-name detection ("X alternative"), tech stack hints, and modifiers like *self-hosted* and *local-first* — all in pure TypeScript, no LLM.
- **Hybrid ranking** — every repo gets a transparent 0–100 score with a clickable breakdown: text relevance, popularity (log-scaled), freshness, health, penalties, optional README boost, optional embedding contribution.
- **README-grounded explanations** — for the top 5 hits, we fetch and parse the README, and if your query terms appear in it we cite that fact in the "why matched" line. No hallucinations — citations come from real fetched text.
- **Optional semantic reranker** — set `ENABLE_EMBEDDING_RERANK=1` to layer cosine-similarity reranking on top of the heuristic, using a local 25MB sentence-transformer (`Xenova/all-MiniLM-L6-v2`). Off by default; deterministic path is always the floor.
- **Shareable URLs** — `/?q=…&sort=stars` auto-runs the search. Filter state is reflected in the URL too. "Copy link" button next to results.
- **Cache** — repeat searches within the hour and README fetches within the day are served from a local JSON file cache (in-memory mirror, debounced flush). Survives restarts; degrades to memory-only if the disk is read-only.
- **Health badges & warnings** — *Active*, *Popular*, *Stale*, *Archived*, *Fork*, *Possible tutorial*, *Awesome list*, *No license*, *Has demo*.
- **Filters & sort** — relevance / stars / recent, language picker, toggle for archived / forks / tutorials & lists.
- **Graceful errors** — clear messaging on rate limits with a hint to add a `GITHUB_TOKEN`.
- **Tested** — 83 unit tests against query expansion, ranking, cache, and embedding math (`npm test`).
- **No database, no auth, no external SaaS.** Next.js + the GitHub REST API + an optional local model.

---

## Setup

### Prerequisites

- **Node.js 18.17+** (Node 20+ recommended).
- A GitHub personal access token is **optional but strongly recommended**. Without one, you'll be rate-limited to 60 requests/hour per IP — fine to try out, but you'll hit limits within a few searches.

### Create a GitHub token

1. Go to <https://github.com/settings/tokens> → **Generate new token (classic)**.
2. **No scopes are required** — public repository search works with an empty-scope token.
3. Give it a name like `github-claw`, set an expiration, generate it, and copy the value.
4. Fine-grained tokens also work: scope it to public repos / read-only.

This raises your rate limit from **60 → 5,000 requests/hour**.

### Install and run

```bash
# 1. Install deps  (--legacy-peer-deps because eslint-config-next@16 + eslint@9 peer ranges are strict)
npm install --legacy-peer-deps

# 2. Configure env
cp .env.example .env.local
# then edit .env.local and paste your token after GITHUB_TOKEN=

# 3. Dev server
npm run dev
# → http://localhost:3000
```

### Other scripts

```bash
npm test            # vitest run — 83 unit tests
npm run test:watch  # watch mode
npm run test:cov    # coverage report (HTML + text)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run build       # production build (Next 16 + Turbopack)
npm run start       # serve the production build
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | No | GitHub PAT. Without it, the app uses unauthenticated GitHub API requests (60 req/hr) and surfaces a warning in the UI. |
| `ENABLE_EMBEDDING_RERANK` | No | Set to `"1"` to enable the semantic reranker. Off by default. First call downloads ~25MB of model weights (cached after that). |

---

## Architecture

```
┌─────────────────────────────────┐
│  app/page.tsx (server)          │  ← Suspense boundary
│  app/HomeClient.tsx (client)    │  ← state, URL ↔ params, fetch
│   ├─ components/SearchBox       │
│   ├─ components/FiltersBar      │
│   └─ components/ResultsList     │
│       └─ components/RepoCard    │  ← score breakdown, README excerpt
└──────────────┬──────────────────┘
               │ POST /api/search { query, filters }
               ▼
┌────────────────────────────────────────────────┐
│  app/api/search/route.ts                       │
│   1. validate request                          │
│   2. ▸ cache check (1h TTL) — return early on hit
│   3. expand query                              │
│   4. fan-out GitHub search → dedupe candidates │
│   5. rank + filter                             │
│   6. ▸ fetch READMEs for top 5 + re-score      │
│   7. ▸ optional embedding rerank (env-gated)   │
│   8. cache write + respond                     │
└──┬───────────┬──────────┬─────────┬────────┬───┘
   │           │          │         │        │
   ▼           ▼          ▼         ▼        ▼
queryExpansion github   ranking  readme   embeddings    cache
   .ts          .ts       .ts      .ts        .ts         .ts
                                                          │
                                                          ▼
                                                   var/*.json
```

### File map

| File | Role |
|---|---|
| `app/page.tsx` | Server component — Suspense boundary around the client. |
| `app/HomeClient.tsx` | Client component: state, URL ↔ filter sync, search fetch, Copy-link button. |
| `app/api/search/route.ts` | Server route: validates, orchestrates, returns the response. |
| `lib/queryExpansion.ts` | Turns a plain-English idea into expansion terms, topics, and GitHub search query strings. |
| `lib/github.ts` | Wrapper around `/search/repositories` with auth, dedupe, and rate-limit handling. |
| `lib/ranking.ts` | Hybrid score + breakdown + badges + explanations. Includes `enrichWithReadmes` post-pass. |
| `lib/readme.ts` | Bounded-concurrency README fetcher with markdown sanitization. |
| `lib/cache.ts` | JSON-file-backed cache with in-memory mirror, debounced flush, and graceful disk fallback. |
| `lib/embeddings.ts` | Optional semantic reranker using transformers.js + MiniLM. Env-gated. |
| `lib/types.ts` | Shared TypeScript types (request, response, repo, ranking). |
| `lib/utils.ts` | Tokenization, stopwords, formatting helpers. |
| `components/*` | UI: `SearchBox`, `RepoCard`, `ResultsList`, `FiltersBar`. |
| `tests/*` | 83 unit tests (Vitest). |

### API contract

`POST /api/search`

```jsonc
// Request
{
  "query": "self-hosted Typeform alternative built with React",
  "filters": {
    "hideArchived": true,
    "hideForks": true,
    "hideTutorials": false,
    "language": "TypeScript",
    "sort": "relevance"   // or "stars" | "recent"
  }
}
```

```jsonc
// Response (200)
{
  "query": "…",
  "expandedQueries": ["…", "…"],
  "results": [
    {
      "fullName": "owner/repo",
      "name": "repo",
      "owner": "owner",
      "url": "https://github.com/owner/repo",
      "description": "…",
      "stars": 12345,
      "forks": 678,
      "language": "TypeScript",
      "license": "AGPL-3.0",
      "topics": ["form-builder", "self-hosted"],
      "homepage": "https://…",
      "pushedAt": "2025-…",
      "updatedAt": "2025-…",
      "archived": false,
      "fork": false,
      "score": 87,
      "scoreBreakdown": {
        "textRelevance": 42,
        "popularity": 18.5,
        "freshness": 15,
        "health": 11,
        "penalty": 0
      },
      "badges": ["Active", "Popular", "Has demo"],
      "warnings": [],
      "whyMatched": "Matched because the repo mentions \"form\", \"typeform\" … It's a TypeScript project, tagged form-builder, self-hosted, actively maintained."
    }
  ],
  "meta": {
    "candidateCount": 75,
    "dedupedCount": 73,
    "rateLimitRemaining": 4938,
    "warnings": []
  }
}
```

Errors return `{ error, hint?, rateLimitRemaining? }` with appropriate HTTP status codes (400 for bad input, 429 for rate limit, 502 for upstream).

---

## How ranking works

Each repo's score is the sum of four positive components minus a penalty, clamped to 0–100. The breakdown is returned to the UI so you can click the score pill on any card to see exactly where its number came from.

| Component | Range | What it rewards |
|---|---|---|
| **Text relevance** | 0–50 | Weighted token overlap with **name** (×6), **topics** (×4), **description** (×2), **language** (×1.5). Multi-word phrases like "form builder" get a small extra bonus on exact-substring match. Original query tokens count 1.5× as much as expansion synonyms. |
| **Popularity** | 0–25 | `log10(stars + 1) × 5`, capped. A 100k-star repo scores ~25; a 10-star repo ~5. Log scale on purpose — we don't want huge meta-projects crowding out niche but well-fitting tools. |
| **Freshness** | 0–15 | Push date: ≤3 mo = 15, ≤6 mo = 12, ≤12 mo = 8, ≤18 mo = 4, else 0. |
| **Health** | 0–12 | +3 license, +2 topics≥2, +2 homepage URL, +2 description >20 chars, +2 stars ≥100, +1 not archived. |
| **Penalty** | subtractive | Archived −15, fork −10, awesome-list −20, tutorial/demo/boilerplate −8, no description −5, no license −2, no pushes in 2y+ −8. |

### Query expansion in one paragraph

`lib/queryExpansion.ts` has a curated map of ~25 software categories (forms, notion-likes, browser agents, terminal recorders, PDF parsers, etc.). Each category has trigger phrases, synonym terms, and GitHub topic slugs. The expander also detects "X alternative", "X clone", common tech stacks (React, Next.js, Rust, Go, …), and modifiers (self-hosted, local-first, offline). It then emits 1–3 orthogonal GitHub search queries: a broad text query, a topic-restricted query, and an alternative/clone variant. Candidates are deduped by `full_name` and capped at 75 before ranking.

### "Why matched" explanations

Deterministic. The explanation cites only the metadata we actually fetched: which user tokens appeared in name/description/topics, the primary language, up to 3 topics, recency, and whether the repo is widely used. We **never** hallucinate README content, contributor lists, or features the API didn't return.

---

## Known limitations

- **GitHub API rate limits.** Without a token, you have 60 requests/hour per IP — that's ~20 searches (each search fires 1–4 sub-queries plus up to 5 README fetches; the cache softens this for repeats). With a token, 5,000/hr. The UI surfaces remaining quota.
- **Semantic reranking is opt-in.** The default path is purely deterministic. Set `ENABLE_EMBEDDING_RERANK=1` to layer cosine similarity on top — first request after server start downloads ~25MB of model weights.
- **No full-code indexing.** README excerpts are now fetched for the top 5, but we still don't read source code. Repos with great code but terrible descriptions *and* terrible READMEs will rank lower than they should.
- **Tutorial / awesome-list detection is regex-only.** A repo named `awesome-design-patterns` will be flagged correctly; a poorly-named tutorial may not be. Use the *Hide tutorials & lists* toggle to filter aggressively.
- **GitHub search itself is fuzzy.** Two identical queries minutes apart can return slightly different result sets. The cache largely hides this for repeats; ranking absorbs the rest.
- **English-only synonym map.** Non-English queries fall through to plain GitHub search with no expansion.
- **SQLite was planned, JSON file used instead.** `better-sqlite3` requires Visual Studio C++ build tools on Windows; we pivoted to a JSON file cache that needs no native deps. Same TTL semantics, slightly less efficient at scale — fine for a single-instance dev/demo.
- **Embedding reranker is server-only and stateful.** The pipeline is loaded once per server instance and held in module scope. On serverless deployments (Vercel functions), each cold start re-downloads/loads the model.

---

## Roadmap / future improvements

Already shipped in this revision (v1.5):
- ✅ Embedding-based reranker (`Xenova/all-MiniLM-L6-v2`, env-gated).
- ✅ README excerpt fetch for the top 5 + grounded "why matched" explanations.
- ✅ JSON-file cache for both searches (1h TTL) and READMEs (24h TTL).
- ✅ Shareable `/?q=…` URLs + "Copy link" button.
- ✅ Vitest unit-test suite (83 tests covering query expansion, ranking, cache, embedding math).
- ✅ Synonym map expanded to ~55 categories.

Still ahead:
- 🏷️ Auto-populate the synonym map from GitHub's `/topics` data on first run.
- 🌐 Multi-source search: include npm / PyPI / crates.io alongside GitHub.
- 🪄 Optional LLM-assisted query expansion (off by default, requires a key, falls back to deterministic).
- 📊 Per-query analytics in dev mode — which sub-queries contributed which candidates.
- 🐳 Dockerfile so the embedding model lives in the image instead of being re-downloaded.

---

## License

MIT — do what you want, attribution appreciated.
