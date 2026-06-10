import { describe, it, expect, vi } from "vitest";
import { searchRepositories, GitHubError } from "@/lib/github";
import type { GitHubRepo } from "@/lib/types";

// Minimal Response-like object honoring the fields github.ts touches.
function res(
  body: unknown,
  { status = 200, headers = {} }: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
  } as unknown as Response;
}

function repoItem(full_name: string, stars = 100): Partial<GitHubRepo> {
  const [, name] = full_name.split("/");
  return { id: 1, full_name, name, stargazers_count: stars } as Partial<GitHubRepo>;
}

describe("searchRepositories", () => {
  it("dedupes by full_name across sub-queries and reports rawCount + min rate-limit", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        res({ items: [repoItem("a/x"), repoItem("b/y")] }, { headers: { "x-ratelimit-remaining": "100" } }),
      )
      .mockResolvedValueOnce(
        res({ items: [repoItem("a/x"), repoItem("c/z")] }, { headers: { "x-ratelimit-remaining": "90" } }),
      );

    const out = await searchRepositories(["q1", "q2"], { fetchImpl });
    expect(out.candidates.map((c) => c.full_name).sort()).toEqual(["a/x", "b/y", "c/z"]);
    expect(out.rawCount).toBe(4); // 2 + 2 before dedupe
    expect(out.rateLimitRemaining).toBe(90); // minimum across queries
    expect(out.failedQueries).toHaveLength(0);
  });

  it("sends the bearer token when provided", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ items: [] }, { headers: { "x-ratelimit-remaining": "5000" } }));
    await searchRepositories(["q"], { token: "T0K3N", fetchImpl });
    const opts = fetchImpl.mock.calls[0][1] as { headers: Record<string, string> };
    expect(opts.headers.Authorization).toBe("Bearer T0K3N");
  });

  it("degrades gracefully when SOME sub-queries fail", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(res({ message: "Validation Failed" }, { status: 422 }))
      .mockResolvedValueOnce(res({ items: [repoItem("a/x")] }, { headers: { "x-ratelimit-remaining": "50" } }));

    const out = await searchRepositories(["bad", "good"], { fetchImpl });
    expect(out.candidates.map((c) => c.full_name)).toEqual(["a/x"]);
    expect(out.failedQueries).toHaveLength(1);
    expect(out.failedQueries[0].status).toBe(422);
  });

  it("throws when EVERY sub-query fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(res({ message: "boom" }, { status: 500 }));
    await expect(searchRepositories(["q1", "q2"], { fetchImpl })).rejects.toBeInstanceOf(GitHubError);
  });

  it("flags rate limiting on a 403 with x-ratelimit-remaining: 0", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(res({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0" } }));
    await expect(searchRepositories(["q"], { fetchImpl })).rejects.toMatchObject({
      rateLimited: true,
      status: 403,
    });
  });

  it("flags a SECONDARY rate limit (403 + retry-after) even when remaining isn't 0", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        res({ message: "You have exceeded a secondary rate limit" }, { status: 403, headers: { "retry-after": "30" } }),
      );
    await expect(searchRepositories(["q"], { fetchImpl })).rejects.toMatchObject({ rateLimited: true });
  });

  it("maps an aborted (timed-out) fetch to a 504 GitHubError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(Object.assign(new Error("aborted"), { name: "AbortError" }));
    await expect(searchRepositories(["q"], { fetchImpl })).rejects.toMatchObject({ status: 504 });
  });
});
