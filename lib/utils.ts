// Small, dependency-free helpers reused by ranking and UI code.

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "for", "with", "to", "from",
  "in", "on", "at", "by", "is", "are", "be", "as", "it", "that", "this",
  "i", "you", "we", "they", "want", "need", "looking", "find", "search",
  "build", "make", "create", "would", "like", "tool", "tools", "thing",
  "something", "app", "apps", "project", "projects", "open", "source",
  "opensource", "free", "best", "good", "any", "some", "my", "your",
]);

export function tokenize(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function meaningfulTokens(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tok of tokenize(text)) {
    if (tok.length < 2) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

// Cap a number to 1 decimal place for display / breakdown values.
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ISO date → "3 months ago" style. Coarse on purpose — we only need rough recency.
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const day = 1000 * 60 * 60 * 24;
  const days = Math.floor(diffMs / day);
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

export function monthsSince(iso: string): number {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return Infinity;
  const day = 1000 * 60 * 60 * 24;
  return (Date.now() - then) / (day * 30);
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
