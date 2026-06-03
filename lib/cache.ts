// JSON-file-backed key-value cache with TTLs. Pure Node, no native deps.
//
// We pivoted from better-sqlite3 because its install requires a C++ toolchain
// the dev machine doesn't have. Our needs are simple — two key→value tables —
// so a JSON file per table with an in-memory mirror is plenty.
//
// Concurrency model: the cache is read into memory once (lazily), then all
// reads hit memory. Writes go to memory immediately and trigger a debounced
// flush (250ms) to avoid hammering the disk during bursts. The flush is
// best-effort — if disk writes fail (read-only FS, perm error) we keep going
// with the in-memory copy and log once.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { SearchResponse } from "./types";

const CACHE_DIR = path.join(process.cwd(), "var");
const SEARCH_FILE = path.join(CACHE_DIR, "search-cache.json");
const README_FILE = path.join(CACHE_DIR, "readme-cache.json");

const SEARCH_TTL_MS = 60 * 60 * 1000; // 1 hour
const README_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FLUSH_DEBOUNCE_MS = 250;
// Hard caps so a busy instance can't grow the JSON files unbounded within the
// TTL window. Oldest entries are evicted first (FIFO via Map insertion order).
const MAX_SEARCH_ENTRIES = 2000;
const MAX_README_ENTRIES = 5000;

interface SearchEntry {
  payload: SearchResponse;
  createdAt: number;
}
interface ReadmeEntry {
  content: string;
  fetchedAt: number;
}

interface Tables {
  search: Map<string, SearchEntry>;
  readme: Map<string, ReadmeEntry>;
}

const tables: Tables = {
  search: new Map(),
  readme: new Map(),
};

let loaded = false;
let diskWritable = true; // flipped to false after the first persistent failure
let pendingFlush: NodeJS.Timeout | null = null;

function loadOnce(): void {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(SEARCH_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SEARCH_FILE, "utf8")) as Record<string, SearchEntry>;
      for (const [k, v] of Object.entries(raw)) tables.search.set(k, v);
    }
    if (fs.existsSync(README_FILE)) {
      const raw = JSON.parse(fs.readFileSync(README_FILE, "utf8")) as Record<string, ReadmeEntry>;
      for (const [k, v] of Object.entries(raw)) tables.readme.set(k, v);
    }
  } catch (err) {
    // Corrupt or unreadable files — start fresh. Surface once for debug.
    console.warn("[cache] failed to load existing cache file, starting fresh:", err);
  }
}

function scheduleFlush(): void {
  if (!diskWritable) return;
  if (pendingFlush) clearTimeout(pendingFlush);
  pendingFlush = setTimeout(() => void flushNow(), FLUSH_DEBOUNCE_MS);
}

async function flushNow(): Promise<void> {
  pendingFlush = null;
  if (!diskWritable) return;
  // GC runs here (debounced) rather than on every write, so the O(n) scan is
  // amortised instead of paid per set.
  gc();
  try {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    // Async writes so a flush never blocks the event loop under load.
    await Promise.all([
      fs.promises.writeFile(SEARCH_FILE, JSON.stringify(Object.fromEntries(tables.search)), "utf8"),
      fs.promises.writeFile(README_FILE, JSON.stringify(Object.fromEntries(tables.readme)), "utf8"),
    ]);
  } catch (err) {
    diskWritable = false;
    console.warn("[cache] disk write failed; continuing in memory only:", err);
  }
}

// Garbage-collect expired entries.
function gc(): void {
  const now = Date.now();
  for (const [k, v] of tables.search) {
    if (now - v.createdAt > SEARCH_TTL_MS) tables.search.delete(k);
  }
  for (const [k, v] of tables.readme) {
    if (now - v.fetchedAt > README_TTL_MS) tables.readme.delete(k);
  }
}

// Evict oldest entries (insertion order) until the table is within its cap.
function evict<T>(table: Map<string, T>, max: number): void {
  while (table.size > max) {
    const oldest = table.keys().next().value;
    if (oldest === undefined) break;
    table.delete(oldest);
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

// `filters` is optional and accepted only for back-compat; the API now keys on
// the query alone (results no longer vary by the client-side display filters).
export function searchCacheKey(query: string, filters?: unknown): string {
  return crypto.createHash("sha1").update(JSON.stringify({ query, filters })).digest("hex");
}

export function getCachedSearch(key: string): SearchResponse | null {
  loadOnce();
  const entry = tables.search.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SEARCH_TTL_MS) {
    tables.search.delete(key);
    return null;
  }
  return entry.payload;
}

export function setCachedSearch(key: string, payload: SearchResponse): void {
  loadOnce();
  // Re-insert so a refreshed key moves to the newest position (FIFO eviction).
  tables.search.delete(key);
  tables.search.set(key, { payload, createdAt: Date.now() });
  evict(tables.search, MAX_SEARCH_ENTRIES);
  scheduleFlush();
}

export function getCachedReadme(fullName: string): string | null {
  loadOnce();
  const entry = tables.readme.get(fullName);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > README_TTL_MS) {
    tables.readme.delete(fullName);
    return null;
  }
  return entry.content;
}

export function setCachedReadme(fullName: string, content: string): void {
  loadOnce();
  tables.readme.delete(fullName);
  tables.readme.set(fullName, { content, fetchedAt: Date.now() });
  evict(tables.readme, MAX_README_ENTRIES);
  scheduleFlush();
}

// Test-only — lets unit tests start from a clean slate.
export function _resetCacheForTests(): void {
  tables.search.clear();
  tables.readme.clear();
  loaded = true; // skip disk load in tests
  diskWritable = false; // and don't touch disk
}
