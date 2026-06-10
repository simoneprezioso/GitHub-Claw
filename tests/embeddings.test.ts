import { describe, it, expect } from "vitest";
import { cosine, blend, embeddingsEnabled } from "@/lib/embeddings";

describe("cosine", () => {
  it("returns 1 for identical vectors", () => {
    const v = new Float32Array([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 5);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toBe(0);
  });

  it("returns negative for opposite vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 5);
  });
});

describe("blend", () => {
  it("perfect semantic match boosts a mediocre heuristic", () => {
    const { finalScore, embeddingPoints } = blend(40, 1.0);
    // 0.6*40 + 0.4*100 = 24 + 40 = 64
    expect(finalScore).toBe(64);
    expect(embeddingPoints).toBeGreaterThan(0);
  });

  it("zero similarity pulls a high heuristic down", () => {
    const { finalScore, embeddingPoints } = blend(80, 0);
    // 0.6*80 + 0.4*0 = 48
    expect(finalScore).toBe(48);
    expect(embeddingPoints).toBeLessThan(0);
  });

  it("clamps similarity to [0,1]", () => {
    expect(blend(50, 5).finalScore).toBeLessThanOrEqual(100);
    expect(blend(50, -5).finalScore).toBeGreaterThanOrEqual(0);
  });

  it("final score is clamped to 0..100", () => {
    expect(blend(200, 1).finalScore).toBeLessThanOrEqual(100);
    expect(blend(-50, 0).finalScore).toBeGreaterThanOrEqual(0);
  });
});

describe("embeddingsEnabled", () => {
  it("is ON by default and opts out via DISABLE_EMBEDDING_RERANK (or legacy =0)", () => {
    const prevEnable = process.env.ENABLE_EMBEDDING_RERANK;
    const prevDisable = process.env.DISABLE_EMBEDDING_RERANK;
    delete process.env.ENABLE_EMBEDDING_RERANK;
    delete process.env.DISABLE_EMBEDDING_RERANK;

    // Default: on (hybrid retrieval is the modern expectation; heuristic is the floor).
    expect(embeddingsEnabled()).toBe(true);

    // Explicit opt-out.
    process.env.DISABLE_EMBEDDING_RERANK = "1";
    expect(embeddingsEnabled()).toBe(false);
    delete process.env.DISABLE_EMBEDDING_RERANK;

    // Legacy opt-out.
    process.env.ENABLE_EMBEDDING_RERANK = "0";
    expect(embeddingsEnabled()).toBe(false);

    // Any other value leaves it on.
    process.env.ENABLE_EMBEDDING_RERANK = "1";
    expect(embeddingsEnabled()).toBe(true);

    if (prevEnable === undefined) delete process.env.ENABLE_EMBEDDING_RERANK;
    else process.env.ENABLE_EMBEDDING_RERANK = prevEnable;
    if (prevDisable === undefined) delete process.env.DISABLE_EMBEDDING_RERANK;
    else process.env.DISABLE_EMBEDDING_RERANK = prevDisable;
  });
});
