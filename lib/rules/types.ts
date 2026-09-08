// Shape of the mock JSON you'll POST once the DL/OCR layer isn't ready yet.
// This mirrors what that layer is expected to eventually output.
export interface ProductDeclaration {
  product_name?: string
  company_name?: string
  mrp_tax_inclusive?: string
  net_quantity?: {
    value: number
    unit: string
    font_height_mm?: number
    // Optional — the DL layer will eventually measure this from the
    // package image, or the officer types it in manually. Without it,
    // font-height compliance can only be flagged for manual review (see
    // ruleEngine.ts).
    principal_display_panel_area_cm2?: number
  }
  mrp?: { amount: number; currency?: string }
  manufacturer?: string
  packed_date?: string // expected "MM/YYYY" — also drives which rule version applies, see ruleVersions.ts
  consumer_care?: string // free text containing phone and/or email
  country_of_origin?: string
  is_imported?: boolean
}

export type Severity = 'CRITICAL' | 'REVIEW_REQUIRED' | 'PASS'

export type CheckCategory =
  | 'Mandatory declarations'
  | 'Format compliance'
  | 'Readability'
  | 'Font analysis'
  | 'Data consistency'

export interface RuleCheckResult {
  code: string
  category: CheckCategory
  field: string
  severity: Severity
  passed: boolean
  confidence: number
  message: string
  // Natural-language query used to fetch the supporting clause from the RAG
  // layer when this check fails.
  legalQuery: string
}

export interface Violation {
  tag: 'CRITICAL' | 'REVIEW REQUIRED'
  title: string
  description: string
  confidence: string
  category: CheckCategory
  legalBasis: { ruleRefs: string[]; snippet: string; page: number; sourceFile: string }[]
}

// Records WHICH dated rule version was actually applied to this product, and
// why — printed on the report so an officer (or a court) can see the basis
// for the finding without re-deriving it themselves.
export interface AppliedRuleVersion {
  version: string
  label: string
  effectiveFrom: string
  reason: string
}

export interface ComplianceResult {
  score: number
  status: 'COMPLIANT' | 'REVIEW REQUIRED' | 'NON-COMPLIANT'
  breakdown: { label: CheckCategory; value: number }[]
  violations: Violation[]
  checks: RuleCheckResult[]
  appliedRuleVersion: AppliedRuleVersion
}
