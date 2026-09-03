import { Schema, models, model } from 'mongoose'

// One row = one retrievable slice of the Legal Metrology (Packaged
// Commodities) Rules, 2011 + its amendments, as ingested from the merged
// gazette PDF. `embedding` is a 384-dim vector from all-MiniLM-L6-v2.
export interface IRuleChunk {
  text: string
  page: number
  sourceFile: string
  ruleRefs: string[] // e.g. ["Rule 6", "Rule 7", "Table-I"] — extracted heuristically, used for filtering/citations
  embedding: number[]
  createdAt: Date
}

const RuleChunkSchema = new Schema<IRuleChunk>({
  text: { type: String, required: true },
  page: { type: Number, required: true },
  sourceFile: { type: String, required: true },
  ruleRefs: { type: [String], default: [] },
  embedding: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now },
})

export default models.RuleChunk || model<IRuleChunk>('RuleChunk', RuleChunkSchema)