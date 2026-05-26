# 🐙 GitHub Claw

> **Find open-source projects from an idea, not keywords.**

GitHub Claw turns a plain-English description of *what you want to build* into a ranked list of real GitHub repos that already exist.

It's a search engine, not a chatbot. No accounts. No paid APIs. No LLMs required.

---

## The pitch in 10 seconds

You type this:

```
open-source local-first Notion clone
```

GitHub Claw types this to GitHub (4 sub-queries, in parallel):

```
open source local first notion clone in:name,description,readme stars:>5
"notion alternative" OR "wiki" OR "knowledge base" OR "outliner" OR "block editor"
  in:name,description stars:>5
topic:notion open source stars:>5
notion alternative in:name,description stars:>5
```

…dedupes the 70+ candidates, re-scores them with a transparent hybrid algorithm, fetches the READMEs for the top 5, and returns:

| #  | Score | Repo | Stars | Why |
|----|-------|------|-------|-----|
| 1  | **72** | [AppFlowy-IO/AppFlowy](https://github.com/AppFlowy-IO/AppFlowy) | 71.3k | "notion", "wiki", "notion alternative" in description + topics; README also mentions "open-source", "notion" |
| 2  | **70** | [siyuan-note/siyuan](https://github.com/siyuan-note/siyuan)     | 44.1k | "local-first", "notion", "notes" in description; README mentions "open source" |
| 3  | **69** | [toeverything/AFFiNE](https://github.com/toeverything/AFFiNE)   | 68.8k | "open-source", "notion", "wiki" in description; README mentions "open-source", "local-first", "notion" |

You never typed "AppFlowy" or "AFFiNE" — they came from synonym expansion + topic mapping + README grounding.

That's the trick.

---

## What kicks ass about this

| | |
|---|---|
| 🎯 **Find tools you don't know exist** | Curated synonym map maps "records terminal sessions as GIFs" → `asciinema`, "kanban for hobbies" → `wekan`/`focalboard`, "self-hosted Typeform" → `quillforms`/`formbricks`. |
| 🧮 **Every score is explainable** | Click a result's score pill to see the breakdown: text relevance, popularity, freshness, health, penalties, README boost, semantic match. No magic. |
| 📖 **Grounded explanations** | "Matched because…" cites only metadata + README text we actually fetched. Never hallucinates. |
| 🧠 **Optional semantic rerank** | `ENABLE_EMBEDDING_RERANK=1` adds a local 25 MB sentence-transformer on top of the heuristic. Off by default. |
| ⚡ **Fast on repeats** | 1h cache for searches, 24h for READMEs. Repeat searches don't touch the GitHub API. |
| 🔗 **Shareable URLs** | `/?q=…&sort=stars` auto-runs. Drop a link in Slack/PR/notes and recipients see the same ranked list. |
| 🧪 **83 unit tests** | Synonym additions are guarded by fixtures so future edits don't silently regress your favorite query. |
| 🪶 **Zero database, zero accounts** | Just Next.js, the GitHub REST API, and a JSON file for cache. |

---

## 30-second setup

```bash
# 1. Install
npm install --legacy-peer-deps

# 2. (Optional but recommended) Drop a GitHub PAT into .env.local
cp .env.example .env.local
#   GITHUB_TOKEN=ghp_…
#   Raises rate limit from 60/hr → 5000/hr. No scopes needed.

# 3. Run
npm run dev
# → http://localhost:3000
```

That's it.

Without a token everything still works — you'll see a friendly warning in the UI when your IP-level quota gets thin.

---

## Live example transcripts

Real outputs from `POST /api/search` against the live GitHub API.

### "self-hosted Typeform alternative built with React"

```
expandedQueries: [
  'self-hosted typeform alternative built react in:name,description,readme stars:>5',
  '"form builder" OR "survey" OR formbricks OR "form.io" OR "self-hosted" in:name,description stars:>5',
  'topic:forms self-hosted stars:>5',
  'typeform alternative in:name,description stars:>5',
]

#1  62  quillforms/quillforms      612 ★   TypeScript   Has demo · Recently updated
#2  58  LimeSurvey/LimeSurvey    3 609 ★   JavaScript   Has demo · Recently updated · No license
#3  49  formsmd/formsmd            761 ★   JavaScript   Has demo
```

### "CLI that records terminal sessions as GIFs"

```
expandedQueries: [
  'cli records terminal sessions gifs in:name,description,readme stars:>5',
  '"terminal recording" OR asciinema OR "tty recorder" OR "terminal gif" OR "shell recording"
   in:name,description stars:>5',
  'topic:terminal cli records stars:>5',
]

#1  66  asciinema/asciinema           17 330 ★   Rust         Popular · Recently updated
#2  56  asciinema/asciinema-player     2 887 ★   JavaScript   Recently updated
#3  56  asciinema/asciinema-server     2 468 ★   Elixir       Recently updated
```

You never typed "asciinema." The synonym map did.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  app/page.tsx (server) ─── <Suspense> ───► app/HomeClient.tsx  │
│                                              (state, URL sync, │
│                                               Copy-link, fetch)│
│        SearchBox  ·  FiltersBar  ·  ResultsList ─► RepoCard    │
└──────────────────────────────┬─────────────────────────────────┘
                               │  POST /api/search
                               ▼
┌────────────────────────────────────────────────────────────────┐
│  app/api/search/route.ts                                       │
│                                                                │
│   1.  validate input                                           │
│   2.  ▸ cache check  ─────────► hit ► return                   │
│   3.  expandQuery()           (synonyms + topics + alt-of-X)   │
│   4.  searchRepositories()    (parallel sub-queries → dedupe)  │
│   5.  rankRepos()             (text+stars+freshness+health-…)  │
│   6.  fetchReadmes() top 5    (parallel, bounded, 4s timeout)  │
│   7.  enrichWithReadmes()     (README-grounded explanations)   │
│   8.  rerankWithEmbeddings()  (optional, env-gated)            │
│   9.  cache write + respond                                    │
└──┬───────────┬──────────┬─────────┬───────────┬──────────┬─────┘
   ▼           ▼          ▼         ▼           ▼          ▼
queryExp.   github     ranking   readme    embeddings   cache
   .ts        .ts        .ts       .ts        .ts         .ts
                                                          │
                                                          ▼
                                                   var/*.json
```

### File map

| File | Role |
|---|---|
| `app/page.tsx` | Server component — Suspense boundary. |
| `app/HomeClient.tsx` | Client state, URL ↔ filters sync, Copy-link, fetch. |
| `app/api/search/route.ts` | Validates, orchestrates the pipeline, responds. |
| `lib/queryExpansion.ts` | Plain English → expansion terms + topics + 3-4 search queries. |
| `lib/github.ts` | `/search/repositories` wrapper, dedupe, rate-limit propagation. |
| `lib/ranking.ts` | Hybrid score, badges, warnings, "why matched", README enrichment. |
| `lib/readme.ts` | Bounded-concurrency README fetch + markdown sanitizer. |
| `lib/cache.ts` | JSON-file cache, in-memory mirror, debounced flush. |
| `lib/embeddings.ts` | Optional semantic reranker (transformers.js + MiniLM). |
| `lib/types.ts`, `lib/utils.ts` | Shared types, tokenization, helpers. |
| `components/*` | `SearchBox`, `RepoCard`, `ResultsList`, `FiltersBar`. |
| `tests/*` | Vitest suite — 83 tests. |

---

## How ranking works

Every result gets a transparent **0–100 score**. Click any score pill in the UI to see the breakdown.

| Component | Range | What it rewards |
|---|---|---|
| **Text relevance** | 0–50 | Weighted token overlap with **name** (×6), **topics** (×4), **description** (×2), **language** (×1.5). Multi-word phrases ("form builder") get an extra bonus on exact-substring match. User-typed tokens count 1.5× as much as expansion synonyms — exact-match repos always beat synonym-only matches. |
| **Popularity** | 0–25 | `log10(stars + 1) × 5`, capped. 100 k ★ ≈ 25, 1 k ★ ≈ 15, 10 ★ ≈ 5. **Log-scaled on purpose** — we don't want huge meta-projects crowding out niche-but-fitting tools. |
| **Freshness** | 0–15 | Push date: ≤3 mo = 15, ≤6 mo = 12, ≤12 mo = 8, ≤18 mo = 4, else 0. |
| **Health** | 0–12 | +3 license, +2 topics ≥2, +2 homepage, +2 description >20 chars, +2 stars ≥100, +1 not archived. |
| **Penalty** | subtractive | Archived −15, fork −10, awesome-list −20, tutorial/demo/boilerplate −8, no description −5, no license −2, no pushes in 2y+ −8. |
| **README boost** *(top 5 only)* | 0–5 | +0.5 per query term found in the fetched README. Caps low so it can't dominate. |
| **Semantic match** *(opt-in)* | −∞..+∞ | `ENABLE_EMBEDDING_RERANK=1` blends `0.6 × heuristic + 0.4 × (cosine × 100)` for the top 20 candidates. The breakdown shows how much the semantic component pulled the score up or down. |

### The deterministic path is always the floor

Embeddings, when enabled, **layer on top** — they never replace the heuristic. The user always gets the explainable ranking; the model just nudges it. This is intentional: heuristics are debuggable, models are not.

---

## The query expansion magic, in one paragraph

`lib/queryExpansion.ts` carries a curated map of **~55 software categories** (forms, notion-likes, terminal recorders, PDF parsers, kanban, browser agents, vector DBs, mesh VPNs, headless CMS, SSGs, photo galleries, music players, RSS readers, …). Each entry has plural-tolerant trigger phrases, synonym terms, and GitHub topic slugs. The expander also detects:

- **"X alternative" / "X clone"** patterns → captures X as a strong signal
- **Tech stacks** ("built with React") → adds the topic + biases the relevance
- **Modifiers** ("self-hosted", "local-first", "offline", "open source") → adds matching topics

It then fires **1–4 orthogonal GitHub search queries** in parallel: a broad text query, a synonym-OR query, a topic-restricted query, and an alternative/clone variant. Candidates are deduped by `full_name` and capped at 75 before ranking.

**Why this matters:** the synonym-OR query is what bridges fuzzy English to canonical project names. *"records terminal sessions as GIFs"* becomes a query that explicitly includes `asciinema OR "terminal recording" OR "tty recorder"` — even though the user never typed "asciinema."

---

## Filters & sorting

- **Sort:** relevance · stars · recently updated
- **Filter:** language (auto-populated from the result set)
- **Toggles:** hide archived · hide forks · hide tutorials & awesome-lists
- **All state is in the URL** — copy the link and recipients see the same view

---

## Tech stack

- **Next.js 16** (App Router, Turbopack), React 18, TypeScript 5, Tailwind 3
- **GitHub REST API** v3 (`/search/repositories`, `/repos/{owner}/{repo}/readme`)
- **Vitest** for tests
- **@xenova/transformers** + `Xenova/all-MiniLM-L6-v2` for the optional reranker (runs locally, no API key)
- **No database.** A `var/*.json` file cache with an in-memory mirror.

---

## Environment variables

| Variable | Required? | Effect |
|---|---|---|
| `GITHUB_TOKEN` | optional, **strongly recommended** | Raises rate limit from 60/hr → 5000/hr per IP. No scopes needed for public repo search. Create at <https://github.com/settings/tokens>. |
| `ENABLE_EMBEDDING_RERANK` | optional | Set to `"1"` to enable the semantic reranker. First request after server start downloads ~25 MB of model weights. |

---

## Scripts

```bash
npm test            # vitest run — 83 unit tests
npm run test:watch  # watch mode
npm run test:cov    # coverage report (HTML + text)
npm run typecheck   # tsc --noEmit
npm run lint        # eslint .
npm run dev         # next dev (Turbopack)
npm run build       # next build
npm run start       # serve production build
```

## Tests at a glance

```
✓ tests/utils.test.ts            17 tests
✓ tests/queryExpansion.test.ts   30 tests   ← fixture corpus for every category
✓ tests/ranking.test.ts          19 tests   ← synthetic repos → expected scores
✓ tests/cache.test.ts             7 tests   ← TTL, keying, eviction
✓ tests/embeddings.test.ts       10 tests   ← cosine + blend math

Test Files  5 passed (5)
     Tests  83 passed (83)
  Duration  ~1.6s
```

---

## Known limitations (kept honest)

- **GitHub API rate limits are real.** Without a token: 60 req/hr per IP. Each search uses up to 4 sub-queries + 5 README fetches = ~9 calls; the cache softens repeats. With a token: 5,000/hr.
- **No full-code indexing.** We score on metadata, description, topics, and (for top 5) README text. A repo with great code, terrible description, *and* terrible README will rank lower than it should.
- **Synonym map is English-only.** Non-English queries fall through to plain GitHub search.
- **Tutorial / awesome-list detection is regex-only.** `awesome-design-patterns` is flagged; a poorly-named tutorial may slip through. The "Hide tutorials & lists" toggle filters aggressively.
- **GitHub search is inherently fuzzy.** Two identical queries minutes apart can return slightly different result sets. The cache hides this for repeats; ranking absorbs the rest.
- **Embedding model is stateful and server-only.** Loaded once per server instance. On serverless deployments (Vercel functions), each cold start re-loads it. Add a CDN-cached copy or a Dockerfile for production.
- **The cache pivoted from SQLite to a JSON file** because `better-sqlite3`'s native build needs a C++ toolchain we couldn't assume on every dev machine. Same TTL semantics, slightly less efficient at huge scale — fine for one-instance dev/demo.

---

## Roadmap

Already shipped (v1.5):

- ✅ Semantic reranker (env-gated, deterministic-first)
- ✅ README excerpt fetch + grounded explanations
- ✅ JSON-file cache (search 1 h TTL, README 24 h TTL)
- ✅ Shareable URLs + Copy-link button
- ✅ 83-test Vitest suite
- ✅ ~55 curated synonym categories

Ahead:

- 🏷️ Auto-populate synonyms from GitHub's `/topics` data
- 🌐 Multi-source: npm, PyPI, crates.io alongside GitHub
- 🪄 Optional LLM-assisted query expansion (key-gated, deterministic fallback)
- 📊 Per-query analytics in dev — which sub-query contributed which candidates
- 🐳 Dockerfile so the embedding model lives in the image

---

## API reference

`POST /api/search`

```jsonc
// Request
{
  "query": "self-hosted Typeform alternative built with React",
  "filters": {
    "hideArchived": true,
    "hideForks": true,
    "hideTutorials": false,
    "language": "TypeScript",      // optional
    "sort": "relevance"            // or "stars" | "recent"
  }
}

// Response (200)
{
  "query": "…",
  "expandedQueries": ["…", "…", "…"],
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
        "textRelevance": 42, "popularity": 18.5, "freshness": 15,
        "health": 11, "penalty": 0,
        "readme": 2.5,                  // only when README enrichment ran
        "embedding": 4.8                // only when ENABLE_EMBEDDING_RERANK=1
      },
      "badges": ["Active", "Popular", "Has demo"],
      "warnings": [],
      "whyMatched": "Matched because the repo mentions \"form\", \"typeform\" … README also mentions \"open-source\".",
      "readmeExcerpt": "…",             // top 5 only
      "readmeMatched": ["open-source"]
    }
  ],
  "meta": {
    "candidateCount": 75,
    "dedupedCount": 73,
    "rateLimitRemaining": 4938,
    "cached": false,
    "warnings": []
  }
}
```

Error responses are `{ error, hint?, rateLimitRemaining? }` with appropriate HTTP status codes (400 bad input, 429 rate limit, 502 upstream).

---

## License

MIT — do what you want, attribution appreciated.

If you find this useful, ⭐ the repo and tell me what query stumped it — that's the best way to grow the synonym map.
