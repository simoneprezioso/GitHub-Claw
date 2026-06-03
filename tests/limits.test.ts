import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, coalesce, withOutboundSlot, clientIp, _resetLimitsForTests } from "@/lib/limits";

beforeEach(() => {
  _resetLimitsForTests();
});

describe("rateLimit (per-key token bucket)", () => {
  it("allows a burst up to capacity then 429s, and refills over time", () => {
    // 20 allowed at a fixed instant…
    for (let i = 0; i < 20; i++) {
      expect(rateLimit("ip1", 1000).allowed).toBe(true);
    }
    // …21st denied, with a positive retry hint.
    const denied = rateLimit("ip1", 1000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);

    // ~3s later one token has refilled (rate ≈ 20/min).
    expect(rateLimit("ip1", 4000).allowed).toBe(true);
  });

  it("tracks separate keys independently", () => {
    for (let i = 0; i < 20; i++) rateLimit("ipA", 1000);
    expect(rateLimit("ipA", 1000).allowed).toBe(false);
    expect(rateLimit("ipB", 1000).allowed).toBe(true);
  });
});

describe("coalesce", () => {
  it("shares one in-flight computation across concurrent identical keys", async () => {
    let calls = 0;
    const fn = () => {
      calls++;
      return new Promise<string>((r) => setTimeout(() => r("v"), 10));
    };
    const [a, b] = await Promise.all([coalesce("k", fn), coalesce("k", fn)]);
    expect(calls).toBe(1);
    expect(a).toBe("v");
    expect(b).toBe("v");

    // After settling the entry is cleared, so a fresh call recomputes.
    await coalesce("k", fn);
    expect(calls).toBe(2);
  });
});

describe("withOutboundSlot", () => {
  it("bounds concurrency to the semaphore limit", async () => {
    let current = 0;
    let max = 0;
    const task = () =>
      withOutboundSlot(async () => {
        current++;
        max = Math.max(max, current);
        await new Promise((r) => setTimeout(r, 5));
        current--;
        return 1;
      });
    await Promise.all(Array.from({ length: 15 }, task));
    expect(max).toBeLessThanOrEqual(6);
    expect(max).toBeGreaterThan(1);
  });
});

describe("clientIp", () => {
  it("reads the first x-forwarded-for entry", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to 'unknown' with no proxy headers", () => {
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});
