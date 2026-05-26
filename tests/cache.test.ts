import { describe, it, expect, beforeEach } from "vitest";
import {
  searchCacheKey,
  getCachedSearch,
  setCachedSearch,
  getCachedReadme,
  setCachedReadme,
  _resetCacheForTests,
} from "@/lib/cache";
import type { SearchResponse } from "@/lib/types";

function fakeResponse(query: string): SearchResponse {
  return {
    query,
    expandedQueries: [],
    results: [],
    meta: { candidateCount: 0, dedupedCount: 0, rateLimitRemaining: null, warnings: [] },
  };
}

beforeEach(() => {
  _resetCacheForTests();
});

describe("searchCacheKey", () => {
  it("is stable for the same input", () => {
    const a = searchCacheKey("react", { sort: "relevance" });
    const b = searchCacheKey("react", { sort: "relevance" });
    expect(a).toBe(b);
  });

  it("differs when filters differ", () => {
    const a = searchCacheKey("react", { sort: "relevance" });
    const b = searchCacheKey("react", { sort: "stars" });
    expect(a).not.toBe(b);
  });

  it("differs when query differs", () => {
    const a = searchCacheKey("react", { sort: "relevance" });
    const b = searchCacheKey("vue", { sort: "relevance" });
    expect(a).not.toBe(b);
  });
});

describe("search cache", () => {
  it("returns null for missing keys", () => {
    expect(getCachedSearch("nope")).toBeNull();
  });

  it("returns set value", () => {
    const r = fakeResponse("react");
    setCachedSearch("k1", r);
    expect(getCachedSearch("k1")).toEqual(r);
  });
});

describe("readme cache", () => {
  it("returns null for missing repos", () => {
    expect(getCachedReadme("foo/bar")).toBeNull();
  });

  it("returns set readme", () => {
    setCachedReadme("foo/bar", "# Hello");
    expect(getCachedReadme("foo/bar")).toBe("# Hello");
  });
});
