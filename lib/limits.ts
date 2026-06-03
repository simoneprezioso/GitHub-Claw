// Abuse protection for the public search endpoint. Three independent guards:
//
//   1. rateLimit()        — per-IP token bucket → 429 on abuse.
//   2. withOutboundSlot() — global semaphore bounding concurrent GitHub calls,
//                           so a traffic spike can't fan out into a quota wipeout.
//   3. coalesce()         — collapses concurrent identical queries onto one
//                           upstream fetch (thundering-herd protection).
//
// IMPORTANT: all state is in-process. On a multi-instance or serverless
// deployment each instance has its own buckets, so for a hosted multi-user
// product back rateLimit() with Redis/Upstash. For a single long-lived instance
// (the dev/demo target) this is effective as-is.

// ─── 1. Per-IP token bucket ──────────────────────────────────────────────────

interface Bucket {
  tokens: number;
  updated: number;
}

const buckets = new Map<string, Bucket>();
const RATE_CAPACITY = 20; // burst allowance
const RATE_REFILL_PER_SEC = 20 / 60; // ~20 requests / minute sustained
const BUCKET_SWEEP_AT = 5000; // bound memory: prune idle buckets past this size

export interface RateResult {
  allowed: boolean;
  retryAfterMs: number;
}

export function rateLimit(key: string, now: number = Date.now()): RateResult {
  if (buckets.size > BUCKET_SWEEP_AT) sweepBuckets(now);
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: RATE_CAPACITY, updated: now };
    buckets.set(key, b);
  }
  const elapsedSec = Math.max(0, (now - b.updated) / 1000);
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + elapsedSec * RATE_REFILL_PER_SEC);
  b.updated = now;

  if (b.tokens >= 1) {
    b.tokens -= 1;
    return { allowed: true, retryAfterMs: 0 };
  }
  const retryAfterMs = Math.ceil(((1 - b.tokens) / RATE_REFILL_PER_SEC) * 1000);
  return { allowed: false, retryAfterMs };
}

function sweepBuckets(now: number): void {
  // Drop buckets that have fully refilled (idle long enough to be irrelevant).
  const idleMs = (RATE_CAPACITY / RATE_REFILL_PER_SEC) * 1000;
  for (const [k, b] of buckets) {
    if (now - b.updated > idleMs) buckets.delete(k);
  }
}

// ─── 2. Outbound concurrency semaphore ───────────────────────────────────────

let active = 0;
const waiters: Array<() => void> = [];
const MAX_CONCURRENT_OUTBOUND = 6;

export async function withOutboundSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_OUTBOUND) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    const next = waiters.shift();
    if (next) next();
  }
}

// ─── 3. In-flight request coalescing ─────────────────────────────────────────

const inflight = new Map<string, Promise<unknown>>();

export function coalesce<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = (async () => fn())().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

// Best-effort client IP extraction from standard proxy headers.
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

// Test-only: reset all in-process limiter state.
export function _resetLimitsForTests(): void {
  buckets.clear();
  inflight.clear();
  waiters.length = 0;
  active = 0;
}
