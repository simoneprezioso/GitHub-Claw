import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/search/route";
import { _resetCacheForTests } from "@/lib/cache";
import { _resetLimitsForTests } from "@/lib/limits";
import type { GitHubRepo, SearchResponse, SearchErrorResponse } from "@/lib/types";

function jsonRes(body: unknown, { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {}): Response {
  return { ok: status < 300, status, headers: new Headers(headers), json: async () => body } as unknown as Response;
}
function textRes(text: string, status = 200): Response {
  return { ok: status < 300, status, text: async () => text } as unknown as Response;
}
function repo(full_name: string, over: Partial<GitHubRepo> = {}): GitHubRepo {
  const [owner, name] = full_name.split("/");
  return {
    id: 1, full_name, name, html_url: `https://github.com/${full_name}`, description: "A useful tool.",
    stargazers_count: 100, forks_count: 0, language: "TypeScript",
    license: { spdx_id: "MIT", name: "MIT License" }, topics: [], homepage: null,
    pushed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    archived: false, fork: false, open_issues_count: 0, default_branch: "main",
    owner: { login: owner, avatar_url: "" }, ...over,
  };
}
function makeReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/search", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
function stubGitHub(items: GitHubRepo[], searchStatus = 200, searchHeaders: Record<string, string> = { "x-ratelimit-remaining": "4999" }) {
  const fn = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/search/repositories")) {
      return searchStatus === 200 ? jsonRes({ items }, { headers: searchHeaders }) : jsonRes({ message: "err" }, { status: searchStatus, headers: searchHeaders });
    }
    if (u.endsWith("/readme")) return textRes("readme");
    return textRes("", 404);
  });
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

beforeEach(() => {
  _resetCacheForTests();
  _resetLimitsForTests();
  process.env.DISABLE_EMBEDDING_RERANK = "1";
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DISABLE_EMBEDDING_RERANK;
});

describe("POST /api/search — validation", () => {
  it("400 on empty query", async () => {
    stubGitHub([repo("a/b")]);
    const res = await POST(makeReq({ query: "" }));
    expect(res.status).toBe(400);
  });

  it("400 on overly long query", async () => {
    stubGitHub([repo("a/b")]);
    const res = await POST(makeReq({ query: "x".repeat(301) }));
    expect(res.status).toBe(400);
  });

  it("400 on invalid JSON", async () => {
    stubGitHub([repo("a/b")]);
    const res = await POST(makeReq("{not json"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/search — happy path & cache", () => {
  it("returns ranked results with cached:false on a miss", async () => {
    stubGitHub([repo("a/b", { description: "A kanban board." })]);
    const res = await POST(makeReq({ query: "kanban board" }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as SearchResponse;
    expect(data.results.length).toBeGreaterThan(0);
    expect(data.meta.cached).toBe(false);
    expect(data.results[0].maintenance.verdict).toBeDefined();
  });

  it("serves the second identical query from cache without hitting GitHub again", async () => {
    const fn = stubGitHub([repo("a/b")]);
    await POST(makeReq({ query: "same query" }));
    const callsAfterFirst = fn.mock.calls.length;
    const res2 = await POST(makeReq({ query: "same query" }));
    const data2 = (await res2.json()) as SearchResponse;
    expect(data2.meta.cached).toBe(true);
    expect(data2.meta.warnings).toEqual([]); // volatile meta scrubbed on cache hit
    expect(fn.mock.calls.length).toBe(callsAfterFirst); // no new network calls
  });
});

describe("POST /api/search — errors", () => {
  it("maps a GitHub rate-limit to 429", async () => {
    stubGitHub([], 403, { "x-ratelimit-remaining": "0" });
    const res = await POST(makeReq({ query: "anything" }));
    expect(res.status).toBe(429);
    const data = (await res.json()) as SearchErrorResponse;
    expect(data.error.toLowerCase()).toContain("rate limit");
  });

  it("429s a single IP that exceeds the burst allowance", async () => {
    stubGitHub([repo("a/b")]);
    let sawLimit = false;
    for (let i = 0; i < 25; i++) {
      const res = await POST(makeReq({ query: `q${i}` }));
      if (res.status === 429) sawLimit = true;
    }
    expect(sawLimit).toBe(true);
  });
});
