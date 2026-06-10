import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizeReadme, fetchReadmes } from "@/lib/readme";
import { _resetCacheForTests } from "@/lib/cache";

beforeEach(() => {
  _resetCacheForTests();
});

function textRes(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

describe("sanitizeReadme", () => {
  it("strips code fences, comments, images, and HTML but keeps prose + link text", () => {
    const raw = [
      "# Title",
      "",
      "Some **prose** with a [link](https://example.com) and an ![img](x.png).",
      "<!-- hidden comment -->",
      "<div>raw html</div>",
      "```js",
      "const secret = 1;",
      "```",
    ].join("\n");
    const out = sanitizeReadme(raw);
    expect(out).toContain("prose");
    expect(out).toContain("link"); // link text preserved
    expect(out).not.toContain("https://example.com"); // url dropped
    expect(out).not.toContain("hidden comment");
    expect(out).not.toContain("const secret"); // code fence removed
    expect(out).not.toContain("<div>");
    expect(out).not.toContain("# Title"); // heading marker removed
  });
});

describe("fetchReadmes", () => {
  it("returns an excerpt per fetchable repo and skips 404s", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/has/readme")) return textRes("This project does a useful thing for teams.");
      return textRes("", 404); // no readme
    }) as unknown as typeof fetch;

    const map = await fetchReadmes(["has/readme", "no/readme"], { fetchImpl });
    expect(map.has("has/readme")).toBe(true);
    expect(map.get("has/readme")).toContain("useful thing");
    expect(map.has("no/readme")).toBe(false);
  });

  it("serves a second fetch of the same repo from cache (no extra network call)", async () => {
    const fetchImpl = vi.fn(async () => textRes("cached content here")) as unknown as typeof fetch;
    await fetchReadmes(["a/b"], { fetchImpl });
    await fetchReadmes(["a/b"], { fetchImpl });
    expect((fetchImpl as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it("returns an empty map for no names", async () => {
    const map = await fetchReadmes([], { fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(map.size).toBe(0);
  });

  it("url-encodes each path segment of the repo full name", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (url: string) => {
      seenUrl = url;
      return textRes("content");
    }) as unknown as typeof fetch;
    // A crafted name with traversal/query chars must not break out of the path.
    await fetchReadmes(["ow ner/re..po?x=1"], { fetchImpl });
    expect(seenUrl).toBe("https://api.github.com/repos/ow%20ner/re..po%3Fx%3D1/readme");
    expect(seenUrl).not.toContain("?x=1");
  });
});
