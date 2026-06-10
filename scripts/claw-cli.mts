#!/usr/bin/env node
// GitHub Claw — terminal surface. Same grounded, verified pipeline as the web
// app: real repos, transparent scores, Adopt/Risky/Abandoned verdicts.
//
//   npm run cli -- "self-hosted Typeform alternative in React"
//   npm run cli -- --json "kanban board"        # machine-readable
//   npm run cli -- --no-rerank --top 5 "rss reader"
//   GITHUB_TOKEN=ghp_… npm run cli -- "mesh vpn"

import { runSearchPipeline } from "../lib/searchPipeline";
import type { RankedRepo, MaintenanceVerdict } from "../lib/types";

const HELP = `GitHub Claw CLI: find real, verified GitHub repos from a plain-English idea.

Usage:
  npm run cli -- [options] "<your idea>"

Options:
  --json          Output the full result payload as JSON.
  --no-rerank     Skip the local semantic reranker (heuristic only).
  --top <n>       How many results to show (default 10).
  -h, --help      Show this help.

Env:
  GITHUB_TOKEN    Optional. Raises the rate limit from 60 to 5000 req/hour.`;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `[${code}m${s}[0m` : s);
const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);

const VERDICT_COLOR: Record<MaintenanceVerdict, string> = {
  Adopt: "32", // green
  Risky: "33", // yellow
  Abandoned: "31", // red
};

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  let top = 10;
  const words: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json" || a === "--no-rerank") flags.add(a);
    else if (a === "-h" || a === "--help") flags.add("--help");
    else if (a === "--top") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) top = Math.floor(n);
    } else if (!a.startsWith("--")) {
      words.push(a);
    }
  }
  return { flags, top, query: words.join(" ").trim() };
}

function printRepo(r: RankedRepo, rank: number): void {
  const verdict = c(VERDICT_COLOR[r.maintenance.verdict], `[${r.maintenance.verdict}]`);
  const stars = `★ ${r.stars.toLocaleString()}`;
  console.log(
    `${bold(`${rank}.`)} ${bold(r.fullName)}  ${verdict}  ${dim(`(${r.score}/100 · ${stars}${r.language ? " · " + r.language : ""})`)}`,
  );
  if (r.description) console.log(`   ${r.description}`);
  if (r.maintenance.reasons.length) console.log(dim(`   ${r.maintenance.reasons.join(" · ")}`));
  console.log(dim(`   ${r.url}`));
  console.log();
}

async function main(): Promise<void> {
  const { flags, top, query } = parseArgs(process.argv.slice(2));

  if (flags.has("--help")) {
    console.log(HELP);
    return;
  }
  if (!query) {
    console.error('Error: no query given.\n\n' + HELP);
    process.exitCode = 1;
    return;
  }

  const token = process.env.GITHUB_TOKEN || undefined;
  const res = await runSearchPipeline(query, {
    token,
    rerank: flags.has("--no-rerank") ? false : undefined,
  });
  const results = res.results.slice(0, top);

  if (flags.has("--json")) {
    console.log(JSON.stringify({ ...res, results }, null, 2));
    return;
  }

  console.log();
  console.log(bold(`Results for "${res.query}"`) + dim(`  (${res.meta.dedupedCount} unique repos scanned)`));
  for (const w of res.meta.warnings) console.log(dim(`! ${w}`));
  console.log();

  if (results.length === 0) {
    console.log("No matching repositories. Try rephrasing your idea.");
    return;
  }
  results.forEach((r, i) => printRepo(r, i + 1));
}

main().catch((err) => {
  console.error("Search failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
