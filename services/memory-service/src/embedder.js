// Local embeddings via transformers.js (all-MiniLM-L6-v2, 384-dim).
// No API key, no per-call cost; the model (~25MB) is cached in /models volume.
// Swappable: set EMBEDDER=openai later without touching callers.
import { pipeline, env } from '@xenova/transformers';

env.cacheDir = process.env.MODEL_CACHE_DIR ?? '/models';

export const EMBEDDING_DIM = 384;

let extractorPromise = null;

function extractor() {
  extractorPromise ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  return extractorPromise;
}

export async function embed(text) {
  const model = await extractor();
  const output = await model(text.slice(0, 4000), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function warmup(log) {
  const start = Date.now();
  await embed('warmup');
  log(`embedder ready in ${Date.now() - start}ms`);
}
