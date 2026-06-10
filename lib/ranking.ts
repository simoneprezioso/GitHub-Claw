// Hybrid ranker. Score components sum to 0-100 (positive parts ≤100, with
// penalties subtracted on top — clamped at end). The breakdown is exported so
// the UI can show users *why* a repo ranked where it did.

import type {
  GitHubRepo,
  HealthBadge,
  Maintenance,
  RankedRepo,
  ScoreBreakdown,
  SortMode,
} from "./types";
import type { ExpandedQuery } from "./queryExpansion";
import {
  clamp,
  meaningfulTokens,
  monthsSince,
  round1,
  safeHttpUrl,
  uniq,
} from "./utils";

// Curated-list ("awesome") detection. The old bare /\bawesome\b/ fired on any
// repo that merely had "awesome" in its description (a very common adjective),
// nuking real libraries. We now require an actual list signal or the canonical
// `awesome-` repo-name prefix.
const AWESOME_PATTERNS: RegExp[] = [
  /\bawesome[- ]list\b/i,
  /\bcurated (list|collection)\b/i,
];
const AWESOME_NAME_PREFIX = /^awesome[-_]/i;

// Tutorial/learning signals strong enough to match anywhere (name/desc/topics).
// Note: we deliberately do NOT match bare /\blearning\b/ — it flagged every
// machine-learning project as a tutorial. We require an instructional phrasing.
const TUTORIAL_TEXT_PATTERNS: RegExp[] = [
  /\btutorial\b/i,
  /\bcourse\b/i,
  /\bcheat[- ]?sheet\b/i,
  /\blearn (to|how|by|the|web|react|python|rust|go|js|javascript)\b/i,
  /\blearning resources?\b/i,
];

// Weak signals that are only meaningful in the NAME or TOPICS — never the
// description. A real, usable product routinely says "live demo", "example
// usage", or "getting started" in its description; that must not penalise it.
const TUTORIAL_NAMEY_PATTERNS: RegExp[] = [
  /\bexamples?\b/i,
  /\bboilerplate\b/i,
  /\bstarter\b/i,
  /\bdemo\b/i,
  /\bsample\b/i,
  /\bplayground\b/i,
  /\bgetting[- ]started\b/i,
  /\bskeleton\b/i,
];

function detectTutorialFlags(repo: GitHubRepo): { tutorial: boolean; awesome: boolean } {
  const anywhere = [repo.name, repo.full_name, repo.description ?? "", ...(repo.topics ?? [])]
    .join(" ")
    .toLowerCase();
  // Name + topics only — excludes the description on purpose.
  const nameTopics = [repo.name, ...(repo.topics ?? [])].join(" ").toLowerCase();

  const awesome =
    AWESOME_NAME_PREFIX.test(repo.name) || AWESOME_PATTERNS.some((re) => re.test(anywhere));
  const tutorial =
    TUTORIAL_TEXT_PATTERNS.some((re) => re.test(anywhere)) ||
    TUTORIAL_NAMEY_PATTERNS.some((re) => re.test(nameTopics));

  return { tutorial, awesome };
}

// Repo-side names/topics often use kebab-case ("kanban-board") or dotted
// names ("form.io"). The user's query is rarely hyphenated, so we expand the
// repo-side token set to *also* include the split components. This lets a
// query "kanban" match a repo named "kanban-board" without making the
// GitHub-search-side query noisier (we only expand the indexing side, not
// the query side).
function indexTokens(text: string): Set<string> {
  const base = meaningfulTokens(text);
  const out = new Set<string>(base);
  for (const tok of base) {
    if (tok.includes("-") || tok.includes(".")) {
      for (const piece of tok.split(/[-.]/)) {
        if (piece.length >= 2) out.add(piece);
      }
    }
  }
  return out;
}

// Text relevance: weighted token overlap against name (highest), topics, and
// description. Capped at 50 so popularity/freshness can still matter.
function scoreTextRelevance(repo: GitHubRepo, expanded: ExpandedQuery): {
  score: number;
  matched: string[];
} {
  const expansionSet = new Set(expanded.expansionTerms.map((t) => t.toLowerCase()));
  const queryTokens = new Set(meaningfulTokens(expanded.rawQuery));
  // "Strong" set = original user tokens; we count those at higher weight than
  // synonyms so a repo matching the user's exact words wins over one that only
  // matched expansion synonyms.
  const allTerms = new Set<string>([...expansionSet, ...queryTokens]);

  const nameTokens = indexTokens(`${repo.name} ${repo.full_name}`);
  const descTokens = indexTokens(repo.description ?? "");
  const topicTokens = new Set((repo.topics ?? []).flatMap((t) => Array.from(indexTokens(t))));
  const langTokens = repo.language ? indexTokens(repo.language) : new Set<string>();

  const matched = new Set<string>();
  let score = 0;

  for (const term of allTerms) {
    const isStrong = queryTokens.has(term);
    const weight = isStrong ? 1.5 : 1.0;
    if (nameTokens.has(term)) {
      score += 6 * weight;
      matched.add(term);
    } else if (topicTokens.has(term)) {
      score += 4 * weight;
      matched.add(term);
    } else if (descTokens.has(term)) {
      score += 2 * weight;
      matched.add(term);
    } else if (langTokens.has(term)) {
      score += 1.5 * weight;
      matched.add(term);
    }
  }

  // Exact-substring bonus when a multi-word query phrase appears in
  // name/description (e.g. "form builder", "self hosted").
  const haystack = `${repo.name} ${repo.full_name} ${repo.description ?? ""} ${(repo.topics ?? []).join(" ")}`.toLowerCase();
  for (const term of expanded.expansionTerms) {
    if (term.includes(" ") && term.length > 4 && haystack.includes(term)) {
      score += 3;
      matched.add(term);
    }
  }

  return { score: Math.min(50, score), matched: Array.from(matched) };
}

// Popularity: log-scaled stars so megaprojects don't crowd out niche-but-fitting
// repos. 100k stars ≈ 25 points, 1k ≈ 15, 10 ≈ 5.
function scorePopularity(stars: number): number {
  return clamp(Math.log10(stars + 1) * 5, 0, 25);
}

// Freshness based on push date. Recent pushes earn full points; abandoned
// repos earn none. The MVP brief says 2y+ should be penalised — that lives
// in the penalty function, this just rewards recency.
function scoreFreshness(pushedAt: string): number {
  const months = monthsSince(pushedAt);
  if (!isFinite(months)) return 0;
  if (months <= 3) return 15;
  if (months <= 6) return 12;
  if (months <= 12) return 8;
  if (months <= 18) return 4;
  return 0;
}

// Health: rewards signals that the repo is maintained, documented, usable.
function scoreHealth(repo: GitHubRepo): number {
  let s = 0;
  if (repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION") s += 3;
  if ((repo.topics ?? []).length >= 2) s += 2;
  if (safeHttpUrl(repo.homepage)) s += 2;
  if (repo.description && repo.description.length > 20) s += 2;
  if (repo.stargazers_count >= 100) s += 2;
  if (!repo.archived) s += 1;
  return clamp(s, 0, 12);
}

function scorePenalties(repo: GitHubRepo, flags: { tutorial: boolean; awesome: boolean }): number {
  let p = 0;
  if (repo.archived) p += 15;
  if (repo.fork) p += 10;
  if (flags.awesome) p += 20;
  if (flags.tutorial) p += 8;
  if (!repo.description) p += 5;
  if (!repo.license?.spdx_id || repo.license.spdx_id === "NOASSERTION") p += 2;
  if (monthsSince(repo.pushed_at) > 24) p += 8;
  return p;
}

function buildBadges(repo: GitHubRepo, flags: { tutorial: boolean; awesome: boolean }): HealthBadge[] {
  const badges: HealthBadge[] = [];
  const months = monthsSince(repo.pushed_at);

  if (repo.archived) badges.push("Archived");
  if (repo.fork) badges.push("Fork");
  if (flags.awesome) badges.push("Awesome list");
  if (flags.tutorial) badges.push("Possible tutorial");

  if (!repo.archived && months <= 3) badges.push("Recently updated");
  if (!repo.archived && months <= 6 && !badges.includes("Recently updated")) badges.push("Active");
  if (months > 18 && !repo.archived) badges.push("Stale");

  if (repo.stargazers_count >= 5000) badges.push("Popular");

  if (!repo.license?.spdx_id || repo.license.spdx_id === "NOASSERTION") badges.push("No license");
  if (safeHttpUrl(repo.homepage)) badges.push("Has demo");

  return uniq(badges);
}

function buildWarnings(repo: GitHubRepo, flags: { tutorial: boolean; awesome: boolean }): string[] {
  const w: string[] = [];
  if (repo.archived) w.push("This repository is archived and no longer maintained.");
  if (repo.fork) w.push("This is a fork — the original may be a better starting point.");
  if (flags.awesome) w.push("Looks like an awesome-list, not an actual project.");
  if (flags.tutorial) w.push("Name/description suggests a tutorial, demo, or starter rather than a product.");
  if (monthsSince(repo.pushed_at) > 24 && !repo.archived) w.push("No commits in over 2 years.");
  return w;
}

// Headline maintenance triage. Every verdict is derived from live, fetched
// GitHub metadata (push date, archive flag, license, fork flag, stars) — never
// invented. This is the trust wedge: an LLM can hallucinate a repo or its
// health; we only ever report what the API actually returned.
function assessMaintenance(
  repo: GitHubRepo,
  flags: { tutorial: boolean; awesome: boolean },
): Maintenance {
  const months = monthsSince(repo.pushed_at);
  const hasLicense = Boolean(
    repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION",
  );

  // Abandoned — hard stops.
  if (repo.archived) {
    return { verdict: "Abandoned", reasons: ["Archived by its owner — read-only"] };
  }
  if (isFinite(months) && months > 24) {
    return { verdict: "Abandoned", reasons: ["No commits in over 2 years"] };
  }

  // Risky — usable, but caveat emptor.
  const risky: string[] = [];
  if (isFinite(months) && months > 12) risky.push("No commits in over a year");
  if (repo.fork) risky.push("This is a fork, not the upstream project");
  if (!hasLicense) risky.push("No open-source license — usage rights unclear");
  if (flags.awesome) risky.push("Looks like a curated list, not a usable project");
  if (flags.tutorial) risky.push("Looks like a tutorial/demo, not a product");
  if (risky.length > 0) return { verdict: "Risky", reasons: risky };

  // Adopt — recent, licensed, no red flags.
  const reasons: string[] = [];
  if (isFinite(months) && months <= 3) reasons.push("Actively maintained (pushed within 3 months)");
  else if (isFinite(months) && months <= 12) reasons.push("Maintained within the past year");
  if (hasLicense) reasons.push(`Licensed (${repo.license!.spdx_id})`);
  if (repo.stargazers_count >= 100) reasons.push("Established user base");
  return {
    verdict: "Adopt",
    reasons: reasons.length > 0 ? reasons : ["Recent activity, no red flags"],
  };
}

function buildExplanation(repo: GitHubRepo, matchedTerms: string[]): string {
  // Sources we can honestly cite. We do NOT fabricate README content.
  const sources: string[] = [];
  if (matchedTerms.length > 0) {
    const sample = matchedTerms.slice(0, 4).map((t) => `"${t}"`).join(", ");
    sources.push(`mentions ${sample} in its name, description, or topics`);
  }
  const factBits: string[] = [];
  if (repo.language) factBits.push(`${repo.language} project`);
  if (repo.topics && repo.topics.length > 0) {
    const topics = repo.topics.slice(0, 3).join(", ");
    factBits.push(`tagged ${topics}`);
  }
  const months = monthsSince(repo.pushed_at);
  if (!repo.archived && isFinite(months)) {
    if (months <= 3) factBits.push("actively maintained");
    else if (months <= 12) factBits.push("updated within the past year");
  }
  if (repo.stargazers_count >= 1000) factBits.push("widely used");

  const parts: string[] = [];
  if (sources.length > 0) parts.push(`Matched because the repo ${sources.join(" and ")}.`);
  else parts.push("Matched as a broad candidate from the GitHub search.");
  if (factBits.length > 0) parts.push(`It's a ${factBits.join(", ")}.`);
  return parts.join(" ");
}

export interface RankInputs {
  repos: GitHubRepo[];
  expanded: ExpandedQuery;
  filters: {
    hideArchived: boolean;
    hideForks: boolean;
    hideTutorials: boolean;
    language?: string;
    sort: SortMode;
  };
}

export function rankRepos(input: RankInputs): RankedRepo[] {
  const { repos, expanded, filters } = input;

  const ranked = repos
    .map<RankedRepo & { _drop?: boolean }>((repo) => {
      const flags = detectTutorialFlags(repo);
      const { score: textRelevance, matched } = scoreTextRelevance(repo, expanded);
      const popularity = scorePopularity(repo.stargazers_count);
      const freshness = scoreFreshness(repo.pushed_at);
      const health = scoreHealth(repo);
      const penalty = scorePenalties(repo, flags);

      const breakdown: ScoreBreakdown = {
        textRelevance: round1(textRelevance),
        popularity: round1(popularity),
        freshness: round1(freshness),
        health: round1(health),
        penalty: round1(penalty),
      };

      const raw = textRelevance + popularity + freshness + health - penalty;
      const score = Math.round(clamp(raw, 0, 100));

      return {
        fullName: repo.full_name,
        name: repo.name,
        owner: repo.owner?.login ?? repo.full_name.split("/")[0] ?? "",
        ownerAvatar: repo.owner?.avatar_url ?? "",
        // Validate the href even though html_url is GitHub-issued (defense in
        // depth); fall back to a canonical, segment-encoded github.com URL.
        url:
          safeHttpUrl(repo.html_url) ??
          `https://github.com/${repo.full_name.split("/").map(encodeURIComponent).join("/")}`,
        description: repo.description,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        license: repo.license?.spdx_id && repo.license.spdx_id !== "NOASSERTION"
          ? repo.license.spdx_id
          : null,
        topics: repo.topics ?? [],
        homepage: safeHttpUrl(repo.homepage),
        pushedAt: repo.pushed_at,
        updatedAt: repo.updated_at,
        archived: repo.archived,
        fork: repo.fork,
        openIssues: repo.open_issues_count,
        score,
        // Keep the unclamped, unrounded raw for tie-breaking (see compareRanked).
        rawScore: round1(raw),
        scoreBreakdown: breakdown,
        maintenance: assessMaintenance(repo, flags),
        badges: buildBadges(repo, flags),
        warnings: buildWarnings(repo, flags),
        whyMatched: buildExplanation(repo, matched),
        _drop:
          (filters.hideArchived && repo.archived) ||
          (filters.hideForks && repo.fork) ||
          (filters.hideTutorials && (flags.tutorial || flags.awesome)) ||
          Boolean(
            filters.language &&
              repo.language &&
              repo.language.toLowerCase() !== filters.language.toLowerCase(),
          ),
      };
    })
    .filter((r) => !r._drop)
    .map((r) => {
      const { _drop, ...rest } = r;
      void _drop;
      return rest;
    });

  // Sort.
  sortRanked(ranked, filters.sort);

  return ranked;
}

// Single source of truth for relevance ordering, reused at every sort site
// (initial rank, post-README re-sort, embedding rerank) so they never disagree.
// Integer `score` first, then the fractional `rawScore` (this is what makes a
// 42.8 outrank a 42.1 that both display as 42, and keeps two penalty-floored
// "0" repos ordered by their true raw quality), then text relevance, then stars
// last — so a tangential megaproject can no longer win a tie over an exact match.
export function compareRanked(a: RankedRepo, b: RankedRepo): number {
  return (
    b.score - a.score ||
    b.rawScore - a.rawScore ||
    b.scoreBreakdown.textRelevance - a.scoreBreakdown.textRelevance ||
    b.stars - a.stars
  );
}

export function sortRanked(ranked: RankedRepo[], sort: SortMode): void {
  switch (sort) {
    case "stars":
      ranked.sort((a, b) => b.stars - a.stars || compareRanked(a, b));
      break;
    case "recent":
      ranked.sort(
        (a, b) =>
          new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime() ||
          compareRanked(a, b),
      );
      break;
    case "relevance":
    default:
      ranked.sort(compareRanked);
  }
}

// Pull the set of unique languages out of a result list for the filter dropdown.
export function uniqueLanguages(repos: RankedRepo[]): string[] {
  const set = new Set<string>();
  for (const r of repos) if (r.language) set.add(r.language);
  return Array.from(set).sort();
}

// Client-side display filtering + sorting over an already-ranked result set.
// The API now returns the full unfiltered pool so toggling hide-archived /
// hide-forks / hide-tutorials / language / sort is instant and costs zero
// GitHub API calls (the old code re-fetched on every toggle). Tutorial/awesome
// detection reuses the badges already computed server-side.
export function applyClientFilters(
  results: RankedRepo[],
  filters: {
    hideArchived: boolean;
    hideForks: boolean;
    hideTutorials: boolean;
    language?: string;
    sort: SortMode;
  },
): RankedRepo[] {
  const lang = filters.language?.toLowerCase();
  const out = results.filter((r) => {
    if (filters.hideArchived && r.archived) return false;
    if (filters.hideForks && r.fork) return false;
    if (
      filters.hideTutorials &&
      (r.badges.includes("Possible tutorial") || r.badges.includes("Awesome list"))
    ) {
      return false;
    }
    if (lang && (!r.language || r.language.toLowerCase() !== lang)) return false;
    return true;
  });
  sortRanked(out, filters.sort);
  return out;
}

// Post-pass: when README excerpts are available for some of the ranked
// candidates, score the overlap between the user's expansion terms and the
// README. The boost is capped (≤5) so it can't dominate the heuristic — it's
// just a nudge that also lets us ground the explanation.
export function enrichWithReadmes(
  ranked: RankedRepo[],
  expanded: ExpandedQuery,
  readmes: Map<string, string>,
): RankedRepo[] {
  if (readmes.size === 0) return ranked;
  const queryTokens = new Set(meaningfulTokens(expanded.rawQuery));
  const allTerms = new Set<string>([
    ...queryTokens,
    ...expanded.expansionTerms.map((t) => t.toLowerCase()),
  ]);

  return ranked.map((r) => {
    const excerpt = readmes.get(r.fullName);
    if (!excerpt) return r;
    const readmeTokens = new Set(meaningfulTokens(excerpt));
    const matched: string[] = [];
    for (const t of allTerms) {
      // Either a whole-token match, or substring for multi-word phrases.
      if (readmeTokens.has(t)) matched.push(t);
      else if (t.includes(" ") && t.length > 4 && excerpt.toLowerCase().includes(t)) matched.push(t);
    }
    // Boost: 0.5 points per matched term, capped at 5.
    const boost = clamp(matched.length * 0.5, 0, 5);
    const newScore = Math.round(clamp(r.score + boost, 0, 100));
    const newRawScore = round1(r.rawScore + boost);

    // Re-state explanation with a README citation when we found real matches.
    const factBits: string[] = [];
    if (matched.length > 0) {
      const sample = matched.slice(0, 3).map((m) => `"${m}"`).join(", ");
      factBits.push(`README also mentions ${sample}`);
    }
    const whyMatched = factBits.length > 0
      ? `${r.whyMatched} ${factBits[0]}.`
      : r.whyMatched;

    return {
      ...r,
      score: newScore,
      rawScore: newRawScore,
      scoreBreakdown: { ...r.scoreBreakdown, readme: round1(boost) },
      readmeExcerpt: excerpt,
      readmeMatched: matched,
      whyMatched,
    };
  });
}
