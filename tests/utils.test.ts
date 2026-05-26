import { describe, it, expect } from "vitest";
import {
  cx,
  tokenize,
  meaningfulTokens,
  uniq,
  round1,
  clamp,
  monthsSince,
  formatNumber,
} from "@/lib/utils";

describe("cx", () => {
  it("joins truthy class fragments", () => {
    expect(cx("a", "b", false, null, undefined, "c")).toBe("a b c");
  });
  it("returns empty string for all-falsy input", () => {
    expect(cx(false, null, undefined)).toBe("");
  });
});

describe("tokenize", () => {
  it("lowercases and splits on whitespace", () => {
    expect(tokenize("Hello World")).toEqual(["hello", "world"]);
  });
  it("preserves dots and hyphens (form.io, self-hosted)", () => {
    expect(tokenize("form.io self-hosted")).toContain("form.io");
    expect(tokenize("form.io self-hosted")).toContain("self-hosted");
  });
  it("strips punctuation but keeps + # for c++/c#", () => {
    expect(tokenize("c++ vs c#")).toEqual(["c++", "vs", "c#"]);
  });
  it("returns [] for empty input", () => {
    expect(tokenize("")).toEqual([]);
  });
});

describe("meaningfulTokens", () => {
  it("removes stopwords", () => {
    const toks = meaningfulTokens("I want to find a tool for converting pdfs");
    expect(toks).not.toContain("i");
    expect(toks).not.toContain("a");
    expect(toks).not.toContain("for");
    expect(toks).not.toContain("the");
    expect(toks).toContain("converting");
    expect(toks).toContain("pdfs");
  });
  it("dedupes", () => {
    const toks = meaningfulTokens("react react react component");
    expect(toks.filter((t) => t === "react")).toHaveLength(1);
  });
  it("drops single-char tokens", () => {
    expect(meaningfulTokens("a b c react")).toContain("react");
    expect(meaningfulTokens("a b c react")).not.toContain("a");
  });
});

describe("uniq", () => {
  it("dedupes while preserving order", () => {
    expect(uniq([3, 1, 2, 1, 3, 4])).toEqual([3, 1, 2, 4]);
  });
});

describe("round1 / clamp", () => {
  it("rounds to 1 decimal", () => {
    expect(round1(1.234)).toBe(1.2);
    expect(round1(1.25)).toBeCloseTo(1.3, 5);
  });
  it("clamps within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});

describe("monthsSince", () => {
  it("returns positive months for past dates", () => {
    const sixMonthsAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30 * 6).toISOString();
    const m = monthsSince(sixMonthsAgo);
    expect(m).toBeGreaterThan(5);
    expect(m).toBeLessThan(7);
  });
  it("returns Infinity for invalid input", () => {
    expect(monthsSince("not a date")).toBe(Infinity);
  });
});

describe("formatNumber", () => {
  it("shortens thousands", () => {
    expect(formatNumber(1234)).toBe("1.2k");
    expect(formatNumber(1000)).toBe("1k");
  });
  it("shortens millions", () => {
    expect(formatNumber(2_500_000)).toBe("2.5M");
    expect(formatNumber(1_000_000)).toBe("1M");
  });
  it("returns small numbers unchanged", () => {
    expect(formatNumber(42)).toBe("42");
    expect(formatNumber(999)).toBe("999");
  });
});
