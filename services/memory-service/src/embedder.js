// Local embeddings via @huggingface/transformers (all-MiniLM-L6-v2, 384-dim).
// No API key, no per-call cost; the model (~25MB) is cached in /models volume.
// Swappable: set EMBEDDER=openai later without touching callers.
//
// Migrated off @xenova/transformers@2 (pulled onnx-proto → protobufjs 6.x, a
// CRITICAL advisory) to @huggingface/transformers@4 (native onnxruntime-node,
// no protobufjs 6.x). dtype 'q8' pins the same int8 quantized model artifact
// (model_quantized.onnx) v2 loaded by default, so embedding behavior is
// unchanged.
import { pipeline, env } from '@huggingface/transformers';

env.cacheDir = process.env.MODEL_CACHE_DIR ?? '/models';

export const EMBEDDING_DIM = 384;

let extractorPromise = null;

function extractor() {
  extractorPromise ??= pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    dtype: 'q8',
  });
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
