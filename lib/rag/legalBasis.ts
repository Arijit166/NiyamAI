import { searchRules, type RuleChunkMatch } from './vectorStore'

export interface LegalCitation {
  ruleRefs: string[]
  page: number
  sourceFile: string
  snippet: string
  relevance: number
}

// Keep citations short — this is a pointer back to the source page, not a
// reproduction of the clause. Officers can open the PDF at that page.
function toCitation(chunk: RuleChunkMatch): LegalCitation {
  const snippet = chunk.text.length > 280 ? chunk.text.slice(0, 280).trim() + '…' : chunk.text.trim()
  return {
    ruleRefs: chunk.ruleRefs,
    page: chunk.page,
    sourceFile: chunk.sourceFile,
    snippet,
    relevance: Math.round(chunk.score * 100) / 100,
  }
}

export async function findLegalBasis(query: string, topK = 3): Promise<LegalCitation[]> {
  const chunks = await searchRules(query, topK)
  return chunks.map(toCitation)
}