// README excerpt fetcher. Only called for the top N (5) ranked candidates so
// we never burn rate limit on the long tail. Failures are swallowed — a repo
// that lacks a fetchable README just doesn't get a snippet.

import { getCachedReadme, setCachedReadme } from "./cache";

const MAX_EXCERPT_CHARS = 1500; // trimmed snippet stored in cache
const PER_FETCH_TIMEOUT_MS = 4000;
const CONCURRENCY = 5;

interface FetchEnv {
  token?: string;
  fetchImpl?: typeof fetch;
}

// Strip markdown noise to make the excerpt useful for both display and the
// "why matched" enrichment. We keep prose; we drop code blocks, HTML comments,
// badge image links, raw HTML tags, headings markers, and consecutive blank lines.
export function sanitizeReadme(raw: string): string {
  let s = raw;
  s = s.replace(/```[\s\S]*?```/g, " ");        // fenced code blocks
  s = s.replace(/<!--[\s\S]*?-->/g, " ");        // html comments
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");   // image refs
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // link text only
  s = s.replace(/<[^>]+>/g, " ");                // raw html tags
  s = s.replace(/^[#>*\-]+\s*/gm, "");           // headings, list markers, blockquotes
  s = s.replace(/^\s*\|.*\|\s*$/gm, " ");        // pipe tables
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// Truncate to a sentence boundary near the cap when possible.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastDot = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf(".\n"));
  if (lastDot > max * 0.6) return slice.slice(0, lastDot + 1) + "…";
  return slice.trimEnd() + "…";
}

async function fetchOne(fullName: string, env: FetchEnv): Promise<string | null> {
  const cached = getCachedReadme(fullName);
  if (cached !== null) return cached;

  const fetchImpl = env.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "github-claw-mvp",
  };
  if (env.token) headers.Authorization = `Bearer ${env.token}`;

  // Encode each path segment. `fullName` is "owner/repo" from the GitHub API
  // today (safe charset), but encoding keeps a future untrusted caller from
  // injecting path traversal or query params into the request URL.
  const safePath = fullName.split("/").map(encodeURIComponent).join("/");
  const url = `https://api.github.com/repos/${safePath}/readme`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_FETCH_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, { headers, signal: ctrl.signal, cache: "no-store" });
    if (!res.ok) return null; // 404 (no readme), 403 (rate limit), etc.
    const raw = await res.text();
    const cleaned = truncate(sanitizeReadme(raw), MAX_EXCERPT_CHARS);
    if (cleaned.length === 0) return null;
    setCachedReadme(fullName, cleaned);
    return cleaned;
  } catch {
    return null; // timeout / network — quietly skip
  } finally {
    clearTimeout(timer);
  }
}

// Bounded-concurrency pool. Each task is independent; a slow/failing one
// must not block siblings.
async function withPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  async function next(): Promise<void> {
    const i = idx++;
    if (i >= items.length) return;
    out[i] = await worker(items[i]);
    return next();
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(runners);
  return out;
}

// Public entry point used by the search route. Fetches READMEs for the given
// `fullNames` in parallel (concurrency-limited), returning a map by full_name.
// Names with no fetchable README are simply absent from the returned map.
export async function fetchReadmes(
  fullNames: string[],
  env: FetchEnv,
): Promise<Map<string, string>> {
  if (fullNames.length === 0) return new Map();
  const results = await withPool(fullNames, CONCURRENCY, (name) => fetchOne(name, env));
  const out = new Map<string, string>();
  fullNames.forEach((name, i) => {
    const r = results[i];
    if (r) out.set(name, r);
  });
  return out;
}
