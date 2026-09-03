import 'dotenv/config'
import { connectDB } from '../lib/mongodb'
import RuleChunk from '../models/RuleChunk'
import { VECTOR_INDEX_NAME } from '../lib/rag/vectorStore'
import { EMBEDDING_DIMENSIONS } from '../lib/rag/embeddings'

async function main() {
  await connectDB()
  const collection = RuleChunk.collection

  const existing = await collection
    .listSearchIndexes(VECTOR_INDEX_NAME)
    .toArray()
    .catch(() => [])

  if (existing.length > 0) {
    console.log(`Index "${VECTOR_INDEX_NAME}" already exists — skipping.`)
    process.exit(0)
  }

  await collection.createSearchIndex({
    name: VECTOR_INDEX_NAME,
    type: 'vectorSearch',
    definition: {
      fields: [
        {
          type: 'vector',
          path: 'embedding',
          numDimensions: EMBEDDING_DIMENSIONS,
          similarity: 'cosine',
        },
        { type: 'filter', path: 'sourceFile' },
      ],
    },
  })

  console.log(`Created Atlas Vector Search index "${VECTOR_INDEX_NAME}" on RuleChunk.embedding.`)
}

main().catch((err) => {
  console.error('Failed to create vector index:', err)
  process.exit(1)
})