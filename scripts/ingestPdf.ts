import fs from 'fs'
import path from 'path'
import { embedBatch } from '../lib/rag/embeddings'
import { upsertChunks, clearChunksForFile, type RuleChunkInput } from '../lib/rag/vectorStore'

const CHUNK_TARGET_WORDS = 220
const CHUNK_OVERLAP_WORDS = 40

const RULE_REF_PATTERNS: [RegExp, string][] = [
  [/rule\s+(\d+[A-Za-z]?)/gi, 'Rule $1'],
  [/table[\s-]*i\b/gi, 'Table-I'],
  [/table[\s-]*ii\b/gi, 'Table-II'],
  [/schedule/gi, 'Schedule'],
]

function extractRuleRefs(text: string): string[] {
  const refs = new Set<string>()
  for (const [pattern, template] of RULE_REF_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      refs.add(template.replace('$1', match[1] ?? ''))
    }
  }
  return Array.from(refs)
}

function chunkPageText(pageText: string): string[] {
  const words = pageText.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []

  const chunks: string[] = []
  let start = 0
  while (start < words.length) {
    const end = Math.min(start + CHUNK_TARGET_WORDS, words.length)
    chunks.push(words.slice(start, end).join(' '))
    if (end === words.length) break
    start = end - CHUNK_OVERLAP_WORDS
  }
  return chunks
}

async function main() {
  const [, , inputPath, sourceFile] = process.argv
  if (!inputPath || !sourceFile) {
    console.error('Usage: npx tsx scripts/ingestPdf.ts <pdftotext-layout-output.txt> <sourceFileName>')
    process.exit(1)
  }

  const fullText = fs.readFileSync(path.resolve(inputPath), 'utf-8')
  const pages = fullText.split('\f')

  console.log(`Read ${pages.length} pages from ${inputPath}`)

  const pending: Omit<RuleChunkInput, 'embedding'>[] = []
  pages.forEach((pageText, i) => {
    const pageNumber = i + 1
    for (const chunkText of chunkPageText(pageText)) {
      if (chunkText.trim().length < 20) continue // skip near-empty pages/footers
      pending.push({
        text: chunkText,
        page: pageNumber,
        sourceFile,
        ruleRefs: extractRuleRefs(chunkText),
      })
    }
  })

  console.log(`Built ${pending.length} chunks. Embedding...`)

  const BATCH_SIZE = 32
  const chunksWithEmbeddings: RuleChunkInput[] = []
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE)
    const embeddings = await embedBatch(batch.map((c) => c.text))
    batch.forEach((c, j) => chunksWithEmbeddings.push({ ...c, embedding: embeddings[j] }))
    console.log(`Embedded ${Math.min(i + BATCH_SIZE, pending.length)} / ${pending.length}`)
  }

  console.log(`Clearing existing chunks for ${sourceFile}...`)
  await clearChunksForFile(sourceFile)

  console.log(`Upserting ${chunksWithEmbeddings.length} chunks...`)
  await upsertChunks(chunksWithEmbeddings)

  console.log(
    'Done. Remember to create the Atlas Vector Search index named',
    "'rule_chunks_vector_index' (see scripts/create-vector-index.ts) before querying."
  )
}

main().catch((err) => {
  console.error('Ingestion failed:', err)
  process.exit(1)
})