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
// (the dev/demo target) this is effective as-is. In production this is surfaced
// once via console.warn (silence with RATE_LIMIT_SINGLE_INSTANCE_ACK=1).
//
// The limiter is only as strong as the IP it keys on — see clientIp() and set
// TRUSTED_PROXY_HOPS to match your proxy topology, or it can be spoofed.

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
  warnIfSingleInstanceInProd();
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

// Number of trusted reverse proxies between the public internet and this app
// (e.g. a CDN/edge + load balancer). MUST match the real deployment topology:
// it tells clientIp() how many trailing X-Forwarded-For entries were appended by
// infrastructure we control (and are therefore trustworthy) vs. supplied by the
// client (forgeable). Default 1 = a single trusted proxy/edge in front, the
// common hosted case (Vercel, a CDN, one nginx). Set 0 for a directly-exposed
// origin with NO proxy, which makes forwarded headers untrusted entirely.
function trustedProxyHops(): number {
  const raw = Number(process.env.TRUSTED_PROXY_HOPS);
  if (!Number.isFinite(raw) || raw < 0) return 1;
  return Math.min(10, Math.floor(raw));
}

// Client IP used as the rate-limit bucket key. Security-critical: if this can be
// spoofed, an attacker rotates it to mint unlimited buckets and bypasses the
// limiter entirely. We therefore NEVER trust the left (client-supplied) end of
// X-Forwarded-For. With `hops` trusted proxies, the last `hops` entries were
// appended by our own infra; the entry just before them is the real client.
// Everything further left is attacker-controlled and ignored.
export function clientIp(req: Request, hops: number = trustedProxyHops()): string {
  // With no trusted proxy, forwarded headers carry no authority — a direct
  // client can set them to anything. Fail closed to a single shared bucket.
  if (hops <= 0) return "unknown";

  // Cloudflare sets cf-connecting-ip at its edge from the real TCP peer; a
  // client behind CF cannot forge it. Only trusted when we expect such an edge.
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();

  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      // Count from the right: parts[len - hops] is the IP the outermost trusted
      // proxy actually observed. Clamp so an attacker can't shrink the list with
      // a short/empty header to slide a spoofed value into the trusted slot.
      const idx = Math.max(0, parts.length - hops);
      return parts[idx]!;
    }
  }

  // x-real-ip is set by reverse proxies (nginx etc.); trust it only as a
  // fallback when XFF is absent and we do expect a proxy.
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();

  return "unknown";
}

// One-time loud warning: the limiter state is in-process, so on a multi-instance
// or serverless deployment each replica has its own buckets and the effective
// limit is N× the configured one. Surfaced once in production so the risk can't
// pass silently; acknowledge (and silence) with RATE_LIMIT_SINGLE_INSTANCE_ACK=1
// once a shared store (Redis/Upstash) backs rateLimit() — see the file header.
let singleInstanceWarned = false;
function warnIfSingleInstanceInProd(): void {
  if (singleInstanceWarned) return;
  singleInstanceWarned = true;
  if (
    process.env.NODE_ENV === "production" &&
    process.env.RATE_LIMIT_SINGLE_INSTANCE_ACK !== "1"
  ) {
    console.warn(
      "[limits] rate limiter state is in-process: on a multi-instance/serverless " +
        "deployment the effective per-IP limit scales with replica count. Back it " +
        "with a shared store, or set RATE_LIMIT_SINGLE_INSTANCE_ACK=1 to silence this.",
    );
  }
}

// Test-only: reset all in-process limiter state.
export function _resetLimitsForTests(): void {
  buckets.clear();
  inflight.clear();
  waiters.length = 0;
  active = 0;
  singleInstanceWarned = false;
}
