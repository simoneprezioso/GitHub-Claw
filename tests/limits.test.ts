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
  const reqWith = (headers: Record<string, string>) =>
    new Request("http://x/", { headers });

  it("with one trusted proxy, takes the entry the proxy appended (not the client-supplied left)", () => {
    // XFF = "<client-spoofed>, <real client the proxy saw>".
    const req = reqWith({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" });
    expect(clientIp(req, 1)).toBe("5.6.7.8");
  });

  it("ignores a forged leading XFF chain — the spoof never reaches the trusted slot", () => {
    const req = reqWith({ "x-forwarded-for": "evil1, evil2, evil3, 9.9.9.9" });
    expect(clientIp(req, 1)).toBe("9.9.9.9");
  });

  it("a short/empty header cannot slide a spoof into the trusted slot (index clamps)", () => {
    // Attacker sends a single value hoping len-hops underflows; we clamp to 0.
    expect(clientIp(reqWith({ "x-forwarded-for": "1.1.1.1" }), 2)).toBe("1.1.1.1");
  });

  it("honors multiple trusted hops", () => {
    // XFF = "<spoof>, <real client>, <inner proxy>". With 2 trusted proxies the
    // last 2 entries were appended by our infra, so the real client is 2nd-from-right.
    const req = reqWith({ "x-forwarded-for": "9.9.9.9, 2.2.2.2, 3.3.3.3" });
    expect(clientIp(req, 2)).toBe("2.2.2.2");
  });

  it("prefers cf-connecting-ip over a spoofable XFF", () => {
    const req = reqWith({ "cf-connecting-ip": "4.4.4.4", "x-forwarded-for": "evil, 5.5.5.5" });
    expect(clientIp(req, 1)).toBe("4.4.4.4");
  });

  it("with no trusted proxy (0 hops), forwarded headers are untrusted → 'unknown'", () => {
    const req = reqWith({ "x-forwarded-for": "1.2.3.4", "cf-connecting-ip": "5.6.7.8" });
    expect(clientIp(req, 0)).toBe("unknown");
  });

  it("falls back to x-real-ip when XFF is absent", () => {
    expect(clientIp(reqWith({ "x-real-ip": "7.7.7.7" }), 1)).toBe("7.7.7.7");
  });

  it("falls back to 'unknown' with no proxy headers", () => {
    expect(clientIp(reqWith({}), 1)).toBe("unknown");
  });
});
