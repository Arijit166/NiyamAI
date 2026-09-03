import { connectDB } from '@/lib/mongodb'
import RuleChunk from '@/models/RuleChunk'
import { embedText } from './embeddings'

// Must match the name you give the Atlas Vector Search index (see
// scripts/create-vector-index.ts / README instructions).
export const VECTOR_INDEX_NAME = 'rule_chunks_vector_index'

export interface RuleChunkInput {
  text: string
  page: number
  sourceFile: string
  ruleRefs: string[]
  embedding: number[]
}

export async function upsertChunks(chunks: RuleChunkInput[]) {
  await connectDB()
  if (chunks.length === 0) return
  await RuleChunk.insertMany(chunks)
}

export async function clearChunksForFile(sourceFile: string) {
  await connectDB()
  await RuleChunk.deleteMany({ sourceFile })
}

export interface RuleChunkMatch {
  text: string
  page: number
  sourceFile: string
  ruleRefs: string[]
  score: number
}

export async function searchRules(query: string, topK = 4): Promise<RuleChunkMatch[]> {
  await connectDB()
  const queryEmbedding = await embedText(query)
  const results = await RuleChunk.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector: queryEmbedding,
        numCandidates: Math.max(topK * 20, 100),
        limit: topK,
      },
    },
    {
      $project: {
        _id: 0,
        text: 1,
        page: 1,
        sourceFile: 1,
        ruleRefs: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ])
  return results as RuleChunkMatch[]
}