// Optional embedding-based reranker, env-gated by ENABLE_EMBEDDING_RERANK=1.
//
// Uses @xenova/transformers (transformers.js) running locally — no API key
// required. The model is `Xenova/all-MiniLM-L6-v2`, 384-dim sentence
// embeddings, ~25MB, downloaded on first use and then cached on disk by
// transformers.js itself.
//
// We rerank only the top-20 heuristic candidates so first-call latency is
// bounded (model load is the slow part; embedding 21 short strings after
// that is fast). The final score blends heuristic and semantic so the
// deterministic ranking stays a strong floor:
//
//   finalScore = 0.6 * heuristic + 0.4 * (similarity * 100)
//
// The blend exposes the embedding contribution in `scoreBreakdown.embedding`
// so the UI can show users why an item moved.

import type { RankedRepo } from "./types";

const TOP_N_TO_RERANK = 20;
const HEURISTIC_WEIGHT = 0.6;
const EMBED_WEIGHT = 0.4;

export function embeddingsEnabled(): boolean {
  return process.env.ENABLE_EMBEDDING_RERANK === "1";
}

// Lazily-initialized pipeline. We type it loosely because transformers.js
// doesn't export a clean Pipeline type and we don't want to wrestle with
// declaration merging in a tiny project.
type FeatureExtractor = (
  input: string | string[],
  opts?: { pooling?: "mean" | "none"; normalize?: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let pipelinePromise: Promise<FeatureExtractor> | null = null;

async function getPipeline(): Promise<FeatureExtractor> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      // Dynamic import keeps the heavy ONNX runtime out of the build graph
      // when the feature is disabled.
      const mod = await import("@xenova/transformers");
      // transformers.js exposes `env` to disable browser-only paths.
      if (mod.env) {
        // We're in Node — disable web/cache-via-fetch quirks.
        mod.env.allowLocalModels = false;
      }
      const extractor = (await mod.pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
      )) as unknown as FeatureExtractor;
      return extractor;
    })();
  }
  return pipelinePromise;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function blend(heuristic: number, similarity: number): {
  finalScore: number;
  embeddingPoints: number;
} {
  const sim = Math.max(0, Math.min(1, similarity));
  const semantic = sim * 100;
  const blended = HEURISTIC_WEIGHT * heuristic + EMBED_WEIGHT * semantic;
  const finalScore = Math.round(Math.max(0, Math.min(100, blended)));
  // The "embedding contribution" we expose is how much the semantic part
  // pulled the score up (or down) from the pure heuristic.
  const embeddingPoints = Math.round((semantic - heuristic) * EMBED_WEIGHT * 10) / 10;
  return { finalScore, embeddingPoints };
}

// Build the text we embed per repo. We use the same fields we score on so
// the embedding sees the same signal.
function repoText(r: RankedRepo): string {
  const parts = [
    r.name,
    r.description ?? "",
    (r.topics ?? []).join(" "),
    r.language ?? "",
    r.readmeExcerpt?.slice(0, 800) ?? "",
  ];
  return parts.filter(Boolean).join(" — ");
}

// Main entry point used by the search route. Returns a new ranked list with
// embedding contributions filled in on the top-N items.
export async function rerankWithEmbeddings(
  query: string,
  ranked: RankedRepo[],
): Promise<RankedRepo[]> {
  if (ranked.length === 0) return ranked;
  const extractor = await getPipeline();

  // 1) Query embedding.
  const q = await extractor(query, { pooling: "mean", normalize: true });
  const qVec = q.data;

  // 2) Repo embeddings for the top-N. Pass an array → transformers.js
  //    batches internally.
  const head = ranked.slice(0, TOP_N_TO_RERANK);
  const texts = head.map(repoText);
  const r = await extractor(texts, { pooling: "mean", normalize: true });
  // `r.data` is a flat Float32Array of length N * 384; slice per row.
  const [n, dim] = r.dims;
  const out: RankedRepo[] = [];
  for (let i = 0; i < n; i++) {
    const row = r.data.slice(i * dim, (i + 1) * dim);
    const sim = cosine(qVec, row);
    const { finalScore, embeddingPoints } = blend(head[i].score, sim);
    out.push({
      ...head[i],
      score: finalScore,
      scoreBreakdown: { ...head[i].scoreBreakdown, embedding: embeddingPoints },
    });
  }

  // The tail keeps its heuristic ranking untouched.
  const tail = ranked.slice(TOP_N_TO_RERANK);

  // Re-sort head only — tail was already in order and stays below the head
  // by construction (head was the top of the heuristic ranking).
  out.sort((a, b) => b.score - a.score || b.stars - a.stars);

  return [...out, ...tail];
}
