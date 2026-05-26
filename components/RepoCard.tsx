"use client";

import { useState } from "react";
import type { RankedRepo, HealthBadge } from "@/lib/types";
import { cx, formatNumber, relativeTime } from "@/lib/utils";

interface Props {
  repo: RankedRepo;
}

const BADGE_STYLES: Record<HealthBadge, string> = {
  "Active": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Popular": "bg-amber-50 text-amber-700 ring-amber-200",
  "Recently updated": "bg-emerald-50 text-emerald-700 ring-emerald-200",
  "Stale": "bg-ink-100 text-ink-500 ring-ink-200",
  "Archived": "bg-red-50 text-red-700 ring-red-200",
  "Fork": "bg-ink-100 text-ink-500 ring-ink-200",
  "Possible tutorial": "bg-amber-50 text-amber-700 ring-amber-200",
  "Awesome list": "bg-amber-50 text-amber-700 ring-amber-200",
  "No license": "bg-ink-100 text-ink-500 ring-ink-200",
  "Has demo": "bg-sky-50 text-sky-700 ring-sky-200",
};

export function RepoCard({ repo }: Props) {
  const [showBreakdown, setShowBreakdown] = useState(false);

  return (
    <article className="group rounded-xl border border-ink-200 bg-white p-5 shadow-card transition hover:border-ink-300">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <a
              href={repo.url}
              target="_blank"
              rel="noreferrer noopener"
              className="break-all text-base font-semibold text-ink-900 underline-offset-2 hover:underline"
            >
              {repo.owner}/<span className="text-ink-900">{repo.name}</span>
            </a>
            {repo.fork && <span className="text-xs text-ink-400">forked</span>}
            {repo.archived && <span className="text-xs text-red-600">archived</span>}
          </div>
          {repo.description ? (
            <p className="mt-1.5 text-sm text-ink-600">{repo.description}</p>
          ) : (
            <p className="mt-1.5 text-sm italic text-ink-400">No description provided.</p>
          )}
        </div>
        <ScorePill score={repo.score} onClick={() => setShowBreakdown((v) => !v)} active={showBreakdown} />
      </header>

      {showBreakdown && (
        <BreakdownPanel breakdown={repo.scoreBreakdown} />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-500">
        {repo.language && (
          <span className="inline-flex items-center gap-1.5">
            <LangDot lang={repo.language} />
            {repo.language}
          </span>
        )}
        <span title="Stars">★ {formatNumber(repo.stars)}</span>
        <span title="Forks">⑂ {formatNumber(repo.forks)}</span>
        {repo.license && <span title="License">{repo.license}</span>}
        <span title={`Pushed at ${repo.pushedAt}`}>updated {relativeTime(repo.pushedAt)}</span>
        {repo.openIssues > 0 && <span title="Open issues">{formatNumber(repo.openIssues)} issues</span>}
      </div>

      {(repo.badges.length > 0 || repo.topics.length > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {repo.badges.map((b) => (
            <span
              key={b}
              className={cx(
                "rounded-full px-2 py-0.5 text-[11px] font-medium ring-1",
                BADGE_STYLES[b],
              )}
            >
              {b}
            </span>
          ))}
          {repo.topics.slice(0, 6).map((t) => (
            <span
              key={t}
              className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-600 ring-1 ring-ink-200"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {repo.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-700">
          {repo.warnings.map((w) => (
            <li key={w} className="flex gap-1.5">
              <span aria-hidden>⚠</span>
              {w}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 rounded-md bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600 ring-1 ring-ink-200/60">
        {repo.whyMatched}
      </p>

      {repo.readmeExcerpt && (
        <details className="mt-2 rounded-md bg-white px-3 py-2 text-xs leading-relaxed text-ink-600 ring-1 ring-ink-200/60">
          <summary className="cursor-pointer select-none text-[11px] font-medium uppercase tracking-wide text-ink-500 hover:text-ink-900">
            From the README
          </summary>
          <p className="mt-2 whitespace-pre-line text-ink-700">{repo.readmeExcerpt}</p>
        </details>
      )}

      <footer className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        <a
          href={repo.url}
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-ink-900 underline-offset-2 hover:underline"
        >
          View on GitHub →
        </a>
        {repo.homepage && (
          <a
            href={repo.homepage}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-sky-700 underline-offset-2 hover:underline"
          >
            Homepage / demo ↗
          </a>
        )}
      </footer>
    </article>
  );
}

function ScorePill({
  score,
  onClick,
  active,
}: {
  score: number;
  onClick: () => void;
  active: boolean;
}) {
  const color =
    score >= 75
      ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
      : score >= 50
      ? "bg-sky-100 text-sky-800 ring-sky-200"
      : score >= 30
      ? "bg-ink-100 text-ink-700 ring-ink-200"
      : "bg-ink-100 text-ink-500 ring-ink-200";
  return (
    <button
      type="button"
      onClick={onClick}
      title={active ? "Hide score breakdown" : "Show score breakdown"}
      className={cx(
        "flex shrink-0 flex-col items-center rounded-lg px-2.5 py-1.5 ring-1 transition",
        color,
        active && "ring-2",
      )}
    >
      <span className="font-mono text-base font-semibold leading-none">{score}</span>
      <span className="mt-0.5 text-[10px] uppercase tracking-wide opacity-70">match</span>
    </button>
  );
}

function BreakdownPanel({ breakdown }: { breakdown: RankedRepo["scoreBreakdown"] }) {
  const rows: Array<[string, number, string]> = [
    ["Text relevance", breakdown.textRelevance, "name / topics / description overlap"],
    ["Popularity", breakdown.popularity, "log-scaled star count"],
    ["Freshness", breakdown.freshness, "recency of last push"],
    ["Health", breakdown.health, "license, topics, homepage, etc."],
    ["Penalty", -breakdown.penalty, "archived / fork / awesome / stale"],
  ];
  if (typeof breakdown.readme === "number" && breakdown.readme > 0) {
    rows.push(["README boost", breakdown.readme, "extra credit for query terms found in the README"]);
  }
  if (typeof breakdown.embedding === "number") {
    rows.push(["Semantic match", breakdown.embedding, "cosine similarity from the embedding reranker (env-gated)"]);
  }
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-ink-50 p-3 text-xs ring-1 ring-ink-200/60 sm:grid-cols-3">
      {rows.map(([label, val, hint]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-ink-500" title={hint}>{label}</dt>
          <dd className={cx("font-mono font-medium", val < 0 ? "text-red-700" : "text-ink-900")}>
            {val > 0 ? `+${val}` : val}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// Tiny colored dot — uses a small built-in table for common languages, falls
// back to a neutral grey otherwise. Not GitHub's full palette, just enough to
// give the cards a quick visual scan handle.
const LANG_COLORS: Record<string, string> = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Go: "#00ADD8",
  Rust: "#dea584",
  Ruby: "#701516",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  Swift: "#F05138",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Shell: "#89e051",
  PHP: "#4F5D95",
  Elixir: "#6e4a7e",
  HTML: "#e34c26",
  CSS: "#563d7c",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Lua: "#000080",
  Dart: "#00B4AB",
  Zig: "#ec915c",
  Nim: "#ffc200",
};

function LangDot({ lang }: { lang: string }) {
  const color = LANG_COLORS[lang] ?? "#a8a8b3";
  return (
    <span
      aria-hidden
      className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/5"
      style={{ backgroundColor: color }}
    />
  );
}
