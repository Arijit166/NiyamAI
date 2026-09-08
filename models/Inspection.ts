import { Schema, models, model, Types } from 'mongoose'

export type InspectionStatus =
  | 'draft'
  | 'captured'
  | 'extracted'
  | 'reviewed'
  | 'compliant'
  | 'review_required'
  | 'non_compliant'

export type FieldStatus = 'extracted' | 'manual' | 'not_applicable' | 'missing'

// One declaration field (e.g. mrp, net_quantity, manufacturer, ...)
export interface IFieldRecord {
  value: string | null
  confidence: number
  source?: string | null // ocr_spatial | regex_label_proximity | llm_text_extraction | recapture_llm_crop | manual
  status: FieldStatus
  reason?: string | null // why it's missing / validation_reason
}

export interface IInspection {
  inspectionId: string // e.g. INS-2026-00126
  officer: Types.ObjectId
  inspectionType: string // Physical store | Supermarket | Warehouse | E-Commerce
  location: { address: string; lat?: number; lng?: number }
  premisesName: string
  notes?: string
  status: InspectionStatus

  // single-capture workflow: one package photo, not a multi-surface set
  capturedImageUrl?: string

  // raw microservice response, kept for audit
  ocrRaw?: Record<string, unknown>

  // field_name -> IFieldRecord, this is what the Extraction screen renders
  fields: Record<string, IFieldRecord>

  // NEW: the exact ProductDeclaration snapshot that was actually evaluated,
  // so a PDF can be regenerated later from history without re-deriving it
  // from `fields` (and without it silently drifting if the mapping logic
  // in the frontend changes in the future).
  declaration?: Record<string, unknown>

  // includes appliedRuleVersion — pinning WHICH dated rule version was used,
  // so this stays historically accurate even after ruleVersions.ts gains
  // further amendments later.
  complianceResult?: Record<string, unknown>
  readability?: Record<string, unknown>
  passedToSeniorOfficer: boolean
  passedAt?: Date | null
  createdAt: Date
  updatedAt: Date
}

const FieldRecordSchema = new Schema<IFieldRecord>(
  {
    value: { type: String, default: null },
    confidence: { type: Number, default: 0 },
    source: { type: String, default: null },
    status: { type: String, enum: ['extracted', 'manual', 'not_applicable', 'missing'], default: 'missing' },
    reason: { type: String, default: null },
  },
  { _id: false }
)

const InspectionSchema = new Schema<IInspection>(
  {
    inspectionId: { type: String, required: true, unique: true },
    officer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    inspectionType: { type: String, default: 'Physical store' },
    location: {
      address: { type: String, default: '' },
      lat: { type: Number },
      lng: { type: Number },
    },
    premisesName: { type: String, default: '' },
    notes: { type: String, default: '' },
    status: {
      type: String,
      enum: ['draft', 'captured', 'extracted', 'reviewed', 'compliant', 'review_required', 'non_compliant'],
      default: 'draft',
    },
    capturedImageUrl: { type: String },
    ocrRaw: { type: Schema.Types.Mixed },
    fields: { type: Map, of: FieldRecordSchema, default: {} },
    declaration: { type: Schema.Types.Mixed },
    complianceResult: { type: Schema.Types.Mixed },
    readability: { type: Schema.Types.Mixed },
    passedToSeniorOfficer: { type: Boolean, default: false },
    passedAt: { type: Date, default: null },
  },
  { timestamps: true }
)

export default models.Inspection || model<IInspection>('Inspection', InspectionSchema)
