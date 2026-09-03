import { pipeline, env, type FeatureExtractionPipeline } from '@xenova/transformers'

// Run fully locally (downloads the model once from HF hub, then caches it
// under node_modules/@xenova/transformers/.cache). No OPENAI_API_KEY or any
// paid embeddings API required — keeps this layer free to run and demo.
env.allowLocalModels = false

let embedderPromise: Promise<FeatureExtractionPipeline> | null = null

function getEmbedder() {
  if (!embedderPromise) {
    // 384-dim sentence embeddings, small (~90MB) and fast on CPU.
    embedderPromise = pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as Promise<FeatureExtractionPipeline>
  }
  return embedderPromise
}

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder()
  const output = await embedder(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data as Float32Array)
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  const embedder = await getEmbedder()
  const out: number[][] = []
  for (const t of texts) {
    const output = await embedder(t, { pooling: 'mean', normalize: true })
    out.push(Array.from(output.data as Float32Array))
  }
  return out
}

export const EMBEDDING_DIMENSIONS = 384