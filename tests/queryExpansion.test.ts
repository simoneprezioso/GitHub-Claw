import { describe, it, expect } from "vitest";
import { expandQuery } from "@/lib/queryExpansion";

// Helper: assert that *at least one* of `needles` appears in `haystack`.
function expectAnyTerm(haystack: string[], needles: string[], label: string) {
  const lc = haystack.map((t) => t.toLowerCase());
  const found = needles.some((n) => lc.includes(n.toLowerCase()));
  if (!found) {
    throw new Error(
      `${label}: expected at least one of [${needles.join(", ")}] in [${haystack.join(", ")}]`,
    );
  }
}

describe("expandQuery — core flagship cases", () => {
  it("typeform alternative → form-builder terms + topics + alt signal", () => {
    const e = expandQuery("self-hosted Typeform alternative built with React");
    expectAnyTerm(e.expansionTerms, ["form builder", "forms", "formbricks", "form.io"], "form terms");
    expectAnyTerm(e.expansionTerms, ["self-hosted", "self hosted"], "self-hosted modifier");
    expectAnyTerm(e.expansionTerms, ["react"], "react tech");
    expectAnyTerm(e.topics, ["forms", "form-builder", "self-hosted", "react"], "topics");
    expect(e.searchQueries.length).toBeGreaterThanOrEqual(2);
    expect(e.searchQueries.some((q) => q.includes("typeform alternative"))).toBe(true);
  });

  it("terminal recorder → asciinema synonyms even when user never types asciinema", () => {
    const e = expandQuery("CLI that records terminal sessions as GIFs");
    expectAnyTerm(e.expansionTerms, ["asciinema", "terminal recording", "screencast", "shell recording"], "recorder synonyms");
    expectAnyTerm(e.topics, ["asciinema", "terminal", "cli", "screencast"], "topics");
    // The synonym OR query is the key bridge — assert it's present.
    expect(e.searchQueries.some((q) => q.includes("asciinema"))).toBe(true);
  });

  it("local-first notion clone → notion synonyms + clone signal", () => {
    const e = expandQuery("open-source local-first Notion clone");
    expectAnyTerm(e.expansionTerms, ["wiki", "knowledge base", "notion alternative", "block editor"], "notion synonyms");
    expectAnyTerm(e.expansionTerms, ["local-first", "local first"], "local-first modifier");
    expectAnyTerm(e.topics, ["notion", "wiki", "local-first"], "topics");
    // "X clone" pattern should capture "notion" as a strong signal.
    expect(e.expansionTerms.map((t) => t.toLowerCase())).toContain("notion");
  });

  it("pdf to json → pdf parser synonyms", () => {
    const e = expandQuery("tool that converts PDFs into structured JSON");
    expectAnyTerm(e.expansionTerms, ["pdf parser", "pdf extraction", "ocr", "document parsing"], "pdf synonyms");
    expectAnyTerm(e.topics, ["pdf", "pdf-parser", "ocr"], "topics");
  });

  it("AI browser agent → playwright + agent terms", () => {
    const e = expandQuery("AI browser agent framework with Playwright");
    expectAnyTerm(e.expansionTerms, ["browser automation", "playwright", "browser agent"], "browser synonyms");
    expectAnyTerm(e.expansionTerms, ["agent framework", "llm agent", "ai agent"], "agent synonyms");
    expectAnyTerm(e.topics, ["browser-automation", "playwright", "llm", "ai-agent"], "topics");
  });
});

describe("expandQuery — alternative / clone patterns", () => {
  it("'alternative to X' captures X", () => {
    const e = expandQuery("looking for an open source alternative to airtable");
    expect(e.expansionTerms.map((t) => t.toLowerCase())).toContain("airtable");
    expect(e.searchQueries.some((q) => q.includes("airtable alternative"))).toBe(true);
  });

  it("'X alternative' captures X", () => {
    const e = expandQuery("slack alternative for small teams");
    expect(e.expansionTerms.map((t) => t.toLowerCase())).toContain("slack");
  });

  it("'X clone' captures X", () => {
    const e = expandQuery("excalidraw clone in vue");
    expect(e.expansionTerms.map((t) => t.toLowerCase())).toContain("excalidraw");
  });
});

describe("expandQuery — trigger matching is plural-tolerant", () => {
  it("'records terminal' matches the recorder category (was a bug)", () => {
    const e = expandQuery("CLI that records terminal sessions as GIFs");
    expectAnyTerm(e.expansionTerms, ["asciinema"], "plural-tolerant trigger");
  });

  it("'survey builder' matches the form category", () => {
    const e = expandQuery("simple survey builder");
    expectAnyTerm(e.topics, ["forms", "survey", "surveys", "form-builder"], "topic from inflected trigger");
  });
});

describe("expandQuery — tech stack hints", () => {
  it("react triggers react topic", () => {
    const e = expandQuery("kanban board in react");
    expect(e.topics).toContain("react");
  });

  it("nextjs (with or without dot) triggers nextjs topic", () => {
    const e1 = expandQuery("admin panel in next.js");
    const e2 = expandQuery("admin panel in nextjs");
    expect(e1.topics).toContain("nextjs");
    expect(e2.topics).toContain("nextjs");
  });

  it("golang and go both trigger go topic", () => {
    expect(expandQuery("cli tool in go").topics).toContain("go");
    expect(expandQuery("cli tool in golang").topics).toContain("go");
  });
});

describe("expandQuery — modifiers", () => {
  it("self-hosted variants", () => {
    expect(expandQuery("self-hosted x").topics).toContain("self-hosted");
    expect(expandQuery("self hosted x").topics).toContain("self-hosted");
  });

  it("local-first / offline", () => {
    expect(expandQuery("local-first notes").topics).toContain("local-first");
  });
});

describe("expandQuery — degenerate inputs", () => {
  it("empty input does not crash and still yields at least one search query", () => {
    const e = expandQuery("");
    expect(e.searchQueries.length).toBeGreaterThan(0);
  });

  it("stopwords-only input falls back to a broad query", () => {
    const e = expandQuery("the a of an");
    expect(e.searchQueries.length).toBeGreaterThan(0);
  });

  it("returns the trimmed raw query verbatim", () => {
    const e = expandQuery("  custom thing  ");
    expect(e.rawQuery).toBe("custom thing");
  });
});

describe("expandQuery — Phase C expanded categories", () => {
  it("kanban / trello-like", () => {
    const e = expandQuery("kanban board for hobbies");
    expectAnyTerm(e.expansionTerms, ["kanban", "task board", "trello alternative", "wekan"], "kanban synonyms");
    expectAnyTerm(e.topics, ["kanban", "trello", "project-management"], "kanban topics");
  });

  it("personal wiki / second brain", () => {
    const e = expandQuery("personal wiki app");
    expectAnyTerm(e.expansionTerms, ["obsidian alternative", "logseq", "personal knowledge", "second brain"], "wiki synonyms");
    expectAnyTerm(e.topics, ["knowledge-base", "notes", "second-brain"], "wiki topics");
  });

  it("static site generator", () => {
    const e = expandQuery("simple static site generator");
    expectAnyTerm(e.expansionTerms, ["hugo", "jekyll", "eleventy", "astro"], "SSG synonyms");
    expectAnyTerm(e.topics, ["static-site-generator", "ssg"], "SSG topics");
  });

  it("headless CMS", () => {
    const e = expandQuery("headless cms for content");
    expectAnyTerm(e.expansionTerms, ["strapi", "directus", "payload"], "CMS synonyms");
    expectAnyTerm(e.topics, ["cms", "headless-cms"], "CMS topics");
  });

  it("vector database", () => {
    const e = expandQuery("vector db for embeddings");
    expectAnyTerm(e.expansionTerms, ["qdrant", "weaviate", "chroma", "milvus"], "vector-db synonyms");
    expectAnyTerm(e.topics, ["vector-database", "embeddings"], "vector-db topics");
  });

  it("rss reader", () => {
    const e = expandQuery("self-hosted rss reader");
    expectAnyTerm(e.expansionTerms, ["miniflux", "freshrss", "feed reader"], "rss synonyms");
    expectAnyTerm(e.topics, ["rss", "feed-reader"], "rss topics");
  });

  it("photo gallery (immich / photoprism)", () => {
    const e = expandQuery("self-hosted photo gallery");
    expectAnyTerm(e.expansionTerms, ["immich", "photoprism"], "photo synonyms");
    expectAnyTerm(e.topics, ["photo-gallery", "photos"], "photo topics");
  });

  it("mesh VPN", () => {
    const e = expandQuery("tailscale alternative");
    expectAnyTerm(e.expansionTerms, ["wireguard", "headscale", "netbird"], "vpn synonyms");
    expectAnyTerm(e.topics, ["mesh-vpn", "wireguard", "vpn"], "vpn topics");
  });

  it("feature flags", () => {
    const e = expandQuery("feature flag service");
    expectAnyTerm(e.expansionTerms, ["unleash", "flagsmith", "launchdarkly alternative"], "feature-flag synonyms");
    expectAnyTerm(e.topics, ["feature-flags", "feature-toggles"], "feature-flag topics");
  });

  it("full text search engine", () => {
    const e = expandQuery("full text search engine");
    expectAnyTerm(e.expansionTerms, ["meilisearch", "typesense", "elasticsearch"], "search synonyms");
    expectAnyTerm(e.topics, ["search-engine", "full-text-search"], "search topics");
  });
});

describe("expandQuery — topic-restricted query is narrow", () => {
  it("uses at most ONE topic qualifier per query (stacking ANDs is too restrictive)", () => {
    const e = expandQuery("self-hosted Typeform alternative built with React");
    const topicQueries = e.searchQueries.filter((q) => q.includes("topic:"));
    for (const q of topicQueries) {
      const count = (q.match(/topic:/g) || []).length;
      expect(count).toBe(1);
    }
  });

  it("prefers a non-tech topic over react/typescript when both are available", () => {
    const e = expandQuery("self-hosted Typeform alternative built with React");
    const topicQ = e.searchQueries.find((q) => q.includes("topic:"));
    if (topicQ) {
      // Should NOT be topic:react when a more specific category topic exists.
      expect(topicQ).not.toMatch(/topic:react\b/);
    }
  });
});
