import { describe, it, expect } from "vitest";
import { rankRepos, uniqueLanguages } from "@/lib/ranking";
import { expandQuery } from "@/lib/queryExpansion";
import type { GitHubRepo, SortMode } from "@/lib/types";

// Build a GitHubRepo with sensible defaults so each test only needs to set
// the fields it cares about.
function makeRepo(overrides: Partial<GitHubRepo> & { full_name: string }): GitHubRepo {
  const [owner, name] = overrides.full_name.split("/");
  return {
    id: Math.floor(Math.random() * 1e9),
    name: overrides.name ?? name,
    full_name: overrides.full_name,
    html_url: `https://github.com/${overrides.full_name}`,
    description: overrides.description ?? null,
    stargazers_count: overrides.stargazers_count ?? 100,
    forks_count: overrides.forks_count ?? 10,
    language: overrides.language ?? "TypeScript",
    license: overrides.license ?? { spdx_id: "MIT", name: "MIT License" },
    topics: overrides.topics ?? [],
    homepage: overrides.homepage ?? null,
    pushed_at: overrides.pushed_at ?? new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    archived: overrides.archived ?? false,
    fork: overrides.fork ?? false,
    open_issues_count: overrides.open_issues_count ?? 0,
    default_branch: overrides.default_branch ?? "main",
    owner: overrides.owner ?? { login: owner, avatar_url: "" },
  };
}

const defaultFilters = (sort: SortMode = "relevance") => ({
  hideArchived: true,
  hideForks: true,
  hideTutorials: false,
  language: undefined,
  sort,
});

describe("rankRepos — text relevance", () => {
  it("repo with query term in NAME ranks above repo with same term only in description", () => {
    const expanded = expandQuery("kanban board");
    const repos = [
      makeRepo({
        full_name: "alice/kanban-board",
        description: "Generic project management.",
        stargazers_count: 50,
      }),
      makeRepo({
        full_name: "bob/some-app",
        description: "A kanban board for teams.",
        stargazers_count: 50,
      }),
    ];
    const ranked = rankRepos({ repos, expanded, filters: defaultFilters() });
    expect(ranked[0].fullName).toBe("alice/kanban-board");
  });

  it("topic match scores higher than description-only match", () => {
    const expanded = expandQuery("kanban board");
    const repos = [
      makeRepo({
        full_name: "alice/proj",
        description: "Track work.",
        topics: ["kanban"],
        stargazers_count: 50,
      }),
      makeRepo({
        full_name: "bob/proj",
        description: "kanban tool for teams",
        topics: [],
        stargazers_count: 50,
      }),
    ];
    const ranked = rankRepos({ repos, expanded, filters: defaultFilters() });
    expect(ranked[0].fullName).toBe("alice/proj");
  });
});

describe("rankRepos — popularity", () => {
  it("higher stars wins all-else-equal", () => {
    const expanded = expandQuery("form builder");
    const repos = [
      makeRepo({ full_name: "a/forms", description: "form builder", stargazers_count: 10 }),
      makeRepo({ full_name: "b/forms", description: "form builder", stargazers_count: 10000 }),
    ];
    const ranked = rankRepos({ repos, expanded, filters: defaultFilters() });
    expect(ranked[0].fullName).toBe("b/forms");
  });

  it("popularity uses log scale (10x stars is NOT 10x popularity)", () => {
    const expanded = expandQuery("anything");
    const r1 = rankRepos({
      repos: [makeRepo({ full_name: "a/a", stargazers_count: 100 })],
      expanded,
      filters: defaultFilters(),
    })[0];
    const r2 = rankRepos({
      repos: [makeRepo({ full_name: "b/b", stargazers_count: 1000 })],
      expanded,
      filters: defaultFilters(),
    })[0];
    // 1000 stars should NOT be 10x the popularity of 100 stars — log scale.
    expect(r2.scoreBreakdown.popularity).toBeLessThan(r1.scoreBreakdown.popularity * 10);
    expect(r2.scoreBreakdown.popularity).toBeGreaterThan(r1.scoreBreakdown.popularity);
  });
});

describe("rankRepos — freshness", () => {
  it("recently pushed gets full freshness; old gets none", () => {
    const expanded = expandQuery("anything");
    const fresh = rankRepos({
      repos: [makeRepo({
        full_name: "a/a",
        pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), // 1mo
      })],
      expanded,
      filters: defaultFilters(),
    })[0];
    const stale = rankRepos({
      repos: [makeRepo({
        full_name: "b/b",
        pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3).toISOString(), // 3yr
      })],
      expanded,
      filters: defaultFilters(),
    })[0];
    expect(fresh.scoreBreakdown.freshness).toBeGreaterThan(stale.scoreBreakdown.freshness);
    expect(stale.scoreBreakdown.freshness).toBe(0);
  });
});

describe("rankRepos — penalties", () => {
  it("archived repo is heavily penalised", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [makeRepo({ full_name: "a/a", archived: true })],
      expanded,
      filters: { ...defaultFilters(), hideArchived: false },
    });
    expect(ranked[0].scoreBreakdown.penalty).toBeGreaterThanOrEqual(15);
    expect(ranked[0].badges).toContain("Archived");
  });

  it("awesome-list is detected and penalised heavily", () => {
    const expanded = expandQuery("react");
    const ranked = rankRepos({
      repos: [makeRepo({
        full_name: "sindre/awesome-react",
        description: "A curated list of awesome React resources.",
      })],
      expanded,
      filters: { ...defaultFilters(), hideTutorials: false },
    });
    expect(ranked[0].badges).toContain("Awesome list");
    expect(ranked[0].scoreBreakdown.penalty).toBeGreaterThanOrEqual(20);
  });

  it("tutorial / boilerplate is detected", () => {
    const expanded = expandQuery("react");
    const ranked = rankRepos({
      repos: [makeRepo({
        full_name: "x/y",
        description: "A boilerplate to learn React.",
      })],
      expanded,
      filters: { ...defaultFilters(), hideTutorials: false },
    });
    expect(ranked[0].badges).toContain("Possible tutorial");
  });

  it("very stale repos (>2y) get an extra penalty", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [makeRepo({
        full_name: "a/a",
        pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3).toISOString(),
      })],
      expanded,
      filters: defaultFilters(),
    });
    expect(ranked[0].scoreBreakdown.penalty).toBeGreaterThanOrEqual(8);
  });
});

describe("rankRepos — filters", () => {
  it("hideArchived removes archived", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [
        makeRepo({ full_name: "a/a", archived: true }),
        makeRepo({ full_name: "b/b", archived: false }),
      ],
      expanded,
      filters: { ...defaultFilters(), hideArchived: true },
    });
    expect(ranked.map((r) => r.fullName)).toEqual(["b/b"]);
  });

  it("hideForks removes forks", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [
        makeRepo({ full_name: "a/a", fork: true }),
        makeRepo({ full_name: "b/b", fork: false }),
      ],
      expanded,
      filters: { ...defaultFilters(), hideForks: true },
    });
    expect(ranked.map((r) => r.fullName)).toEqual(["b/b"]);
  });

  it("hideTutorials removes awesome-lists and tutorials", () => {
    const expanded = expandQuery("react");
    const ranked = rankRepos({
      repos: [
        makeRepo({ full_name: "x/awesome-react", description: "Curated list of awesome React stuff." }),
        makeRepo({ full_name: "y/react-app", description: "A React app." }),
      ],
      expanded,
      filters: { ...defaultFilters(), hideTutorials: true },
    });
    expect(ranked.map((r) => r.fullName)).toEqual(["y/react-app"]);
  });

  it("language filter restricts to a single language", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [
        makeRepo({ full_name: "a/a", language: "TypeScript" }),
        makeRepo({ full_name: "b/b", language: "Python" }),
      ],
      expanded,
      filters: { ...defaultFilters(), language: "python" },
    });
    expect(ranked.map((r) => r.fullName)).toEqual(["b/b"]);
  });
});

describe("rankRepos — sorting", () => {
  const base = expandQuery("anything");
  const repos = [
    makeRepo({
      full_name: "a/older-popular",
      stargazers_count: 10000,
      pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 700).toISOString(),
    }),
    makeRepo({
      full_name: "b/recent-quiet",
      stargazers_count: 50,
      pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    }),
  ];

  it("sort=stars orders by raw star count", () => {
    const ranked = rankRepos({ repos, expanded: base, filters: defaultFilters("stars") });
    expect(ranked[0].fullName).toBe("a/older-popular");
  });

  it("sort=recent orders by pushed_at desc", () => {
    const ranked = rankRepos({ repos, expanded: base, filters: defaultFilters("recent") });
    expect(ranked[0].fullName).toBe("b/recent-quiet");
  });
});

describe("rankRepos — badges & explanation", () => {
  it("popular + recently updated + has demo all present when warranted", () => {
    const expanded = expandQuery("anything");
    const ranked = rankRepos({
      repos: [makeRepo({
        full_name: "a/a",
        stargazers_count: 12000,
        pushed_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
        homepage: "https://demo.example.com",
      })],
      expanded,
      filters: defaultFilters(),
    });
    expect(ranked[0].badges).toContain("Popular");
    expect(ranked[0].badges).toContain("Recently updated");
    expect(ranked[0].badges).toContain("Has demo");
  });

  it("whyMatched cites concrete matched terms when present", () => {
    const expanded = expandQuery("typeform alternative");
    const ranked = rankRepos({
      repos: [makeRepo({
        full_name: "x/forms",
        description: "An open-source Typeform alternative.",
        topics: ["typeform", "forms"],
      })],
      expanded,
      filters: defaultFilters(),
    });
    expect(ranked[0].whyMatched.toLowerCase()).toMatch(/typeform/);
  });

  it("whyMatched does NOT include README claims when no README was fetched", () => {
    const expanded = expandQuery("react");
    const ranked = rankRepos({
      repos: [makeRepo({ full_name: "x/y", description: "A React app." })],
      expanded,
      filters: defaultFilters(),
    });
    // We never invent README content in the MVP path.
    expect(ranked[0].whyMatched.toLowerCase()).not.toMatch(/readme/);
  });
});

describe("uniqueLanguages", () => {
  it("returns unique sorted languages, skipping null", () => {
    const expanded = expandQuery("x");
    const ranked = rankRepos({
      repos: [
        makeRepo({ full_name: "a/a", language: "TypeScript" }),
        makeRepo({ full_name: "b/b", language: "Python" }),
        makeRepo({ full_name: "c/c", language: null }),
        makeRepo({ full_name: "d/d", language: "Python" }),
      ],
      expanded,
      filters: defaultFilters(),
    });
    expect(uniqueLanguages(ranked)).toEqual(["Python", "TypeScript"]);
  });
});
