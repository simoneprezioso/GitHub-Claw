// Optional embedding-based reranker, env-gated by ENABLE_EMBEDDING_RERANK=1.
//
// Uses @huggingface/transformers (transformers.js v3) running locally — no API
// key required. The model is `Xenova/all-MiniLM-L6-v2`, 384-dim sentence
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
import { compareRanked } from "./ranking";

const TOP_N_TO_RERANK = 20;
const HEURISTIC_WEIGHT = 0.6;
const EMBED_WEIGHT = 0.4;

// Bounded cache of per-repo embedding vectors, keyed by the exact text we embed.
// The same repo recurs across many queries, so this avoids re-embedding it; the
// query vector is never cached (it changes every search).
const vecCache = new Map<string, Float32Array>();
const VEC_CACHE_MAX = 3000;

export function embeddingsEnabled(): boolean {
  // ON by default — 2025-era retrieval is hybrid (lexical + dense rerank), and
  // the deterministic heuristic remains the floor (we blend it 60/40 and the
  // route falls back to pure heuristic if the model can't load). Opt out with
  // DISABLE_EMBEDDING_RERANK=1, or the legacy ENABLE_EMBEDDING_RERANK=0.
  if (process.env.DISABLE_EMBEDDING_RERANK === "1") return false;
  if (process.env.ENABLE_EMBEDDING_RERANK === "0") return false;
  return true;
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
      const mod = await import("@huggingface/transformers");
      // transformers.js exposes `env` to configure model loading.
      if (mod.env) {
        // Bundle the model in your image and set TRANSFORMERS_MODEL_PATH to the
        // directory containing it to avoid a ~25MB download on every cold start
        // (the big serverless tax). Otherwise we fetch + disk-cache from the hub.
        const localPath = process.env.TRANSFORMERS_MODEL_PATH;
        if (localPath) {
          mod.env.allowLocalModels = true;
          mod.env.localModelPath = localPath;
        } else {
          mod.env.allowLocalModels = false;
        }
      }
      const extractor = (await mod.pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2",
        // v2 quantized by default; v3 defaults to fp32. q8 keeps the ~25MB
        // download and matches the embeddings this app has always produced.
        { dtype: "q8" },
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

  // 2) Repo embeddings for the top-N, served from the per-repo vector cache
  //    where possible; only the uncached texts are sent to the model (batched).
  const head = ranked.slice(0, TOP_N_TO_RERANK);
  const texts = head.map(repoText);
  const rowVecs: Float32Array[] = new Array(texts.length);
  const missingIdx: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    const hit = vecCache.get(texts[i]);
    if (hit) rowVecs[i] = hit;
    else missingIdx.push(i);
  }

  if (missingIdx.length > 0) {
    const r = await extractor(missingIdx.map((i) => texts[i]), {
      pooling: "mean",
      normalize: true,
    });
    // `r.data` is a flat Float32Array of length missing * 384; slice per row.
    const dim = r.dims[r.dims.length - 1];
    missingIdx.forEach((origIdx, k) => {
      const row = r.data.slice(k * dim, (k + 1) * dim);
      rowVecs[origIdx] = row;
      cacheVec(texts[origIdx], row);
    });
  }

  const out: RankedRepo[] = head.map((repo, i) => {
    const sim = cosine(qVec, rowVecs[i]);
    const { finalScore, embeddingPoints } = blend(repo.score, sim);
    return {
      ...repo,
      score: finalScore,
      // Keep rawScore monotonic with the blended score so downstream tie-breaks
      // (compareRanked) preserve the rerank's effect instead of undoing it.
      rawScore: finalScore,
      scoreBreakdown: { ...repo.scoreBreakdown, embedding: embeddingPoints },
    };
  });

  // The tail keeps its heuristic ranking untouched — but blending can DROP a
  // head item below an untouched tail item, so we must sort the MERGED list,
  // not just the head (the old code sorted only the head and lost global order).
  const merged = [...out, ...ranked.slice(TOP_N_TO_RERANK)];
  merged.sort(compareRanked);
  return merged;
}

function cacheVec(text: string, vec: Float32Array): void {
  if (vecCache.size >= VEC_CACHE_MAX) {
    // FIFO eviction — Map preserves insertion order.
    const oldest = vecCache.keys().next().value;
    if (oldest !== undefined) vecCache.delete(oldest);
  }
  vecCache.set(text, vec);
}
