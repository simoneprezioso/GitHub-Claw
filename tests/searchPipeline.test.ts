import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSearchPipeline } from "@/lib/searchPipeline";
import { _resetCacheForTests } from "@/lib/cache";
import type { GitHubRepo } from "@/lib/types";

function jsonRes(body: unknown, headers: Record<string, string> = {}): Response {
  return { ok: true, status: 200, headers: new Headers(headers), json: async () => body } as unknown as Response;
}
function textRes(text: string, status = 200): Response {
  return { ok: status < 300, status, text: async () => text } as unknown as Response;
}
function repo(full_name: string, over: Partial<GitHubRepo> = {}): GitHubRepo {
  const [owner, name] = full_name.split("/");
  return {
    id: 1,
    full_name,
    name,
    html_url: `https://github.com/${full_name}`,
    description: null,
    stargazers_count: 100,
    forks_count: 0,
    language: "TypeScript",
    license: { spdx_id: "MIT", name: "MIT License" },
    topics: [],
    homepage: null,
    pushed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    archived: false,
    fork: false,
    open_issues_count: 0,
    default_branch: "main",
    owner: { login: owner, avatar_url: "" },
    ...over,
  };
}

beforeEach(() => {
  _resetCacheForTests();
  process.env.DISABLE_EMBEDDING_RERANK = "1"; // keep tests offline + fast
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.DISABLE_EMBEDDING_RERANK;
});

describe("runSearchPipeline", () => {
  it("ranks the FULL deduped pool — a low-star exact match outranks a high-star tangential repo", async () => {
    const items = [
      repo("niche/kanban-board", {
        stargazers_count: 3,
        description: "A self-hosted kanban board for teams to track work.",
        topics: ["kanban", "board"],
      }),
      repo("big/web-framework", {
        stargazers_count: 3000,
        description: "A popular general-purpose web framework.",
        topics: ["framework"],
      }),
    ];
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/search/repositories")) return jsonRes({ items }, { "x-ratelimit-remaining": "4999" });
      if (u.endsWith("/readme")) return textRes("kanban board readme content");
      return textRes("", 404);
    }) as unknown as typeof fetch;

    const res = await runSearchPipeline("kanban board", { token: "T" });
    // The whole point of the candidate-cap fix: the 3-star exact match is NOT
    // evicted by the 3000-star tangential repo before scoring.
    expect(res.results[0].fullName).toBe("niche/kanban-board");
    expect(res.meta.dedupedCount).toBe(2);
    expect(res.meta.candidateCount).toBeGreaterThanOrEqual(2); // rawCount across sub-queries
    expect(res.meta.reranked).toBe(false);
  });

  it("warns when running without a token", async () => {
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/search/repositories")) return jsonRes({ items: [repo("a/b")] }, { "x-ratelimit-remaining": "59" });
      return textRes("", 404);
    }) as unknown as typeof fetch;

    const res = await runSearchPipeline("anything", {});
    expect(res.meta.warnings.join(" ")).toMatch(/without a github token/i);
  });
});
