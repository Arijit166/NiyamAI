import type { ProductDeclaration } from './types'

export interface MandatoryFieldSpec {
  field: keyof ProductDeclaration
  label: string
  legalQuery: string
}

export interface FontHeightRow {
  maxAreaCm2: number
  minHeightMm: number
}

export interface RuleVersion {
  version: string // e.g. "2011-original"
  label: string // human-readable, shown to the officer + printed on the PDF
  effectiveFrom: string // ISO date — applies from this date until the next version's effectiveFrom
  mandatoryFields: MandatoryFieldSpec[]
  fontHeightTable: FontHeightRow[]
  validUnits: string[]
  // Appended to every legalQuery sent to the RAG layer so retrieval is
  // biased toward the gazette pages for THIS version, not just any page
  // that happens to match the topic keyword.
  legalQuerySuffix: string
}

const BASE_MANDATORY_FIELDS: MandatoryFieldSpec[] = [
  { field: 'product_name', label: 'Product name / common generic name', legalQuery: 'common or generic name of commodity declaration rule 6' },
  { field: 'net_quantity', label: 'Net quantity', legalQuery: 'net quantity declaration standard unit rule 6' },
  { field: 'mrp', label: 'Maximum Retail Price (MRP)', legalQuery: 'retail sale price inclusive of taxes declaration rule 6' },
  { field: 'manufacturer', label: 'Manufacturer / packer / importer name and address', legalQuery: 'name and address of manufacturer packer importer rule 6' },
  { field: 'packed_date', label: 'Month and year of manufacture / packing / import', legalQuery: 'month and year of manufacture or packing declaration rule 6' },
  { field: 'consumer_care', label: 'Consumer care details', legalQuery: 'consumer care email id and phone number declaration' },
]

// Rule 7(2) + Table-I, AS ORIGINALLY NOTIFIED in 2011.
// NOTE: adjust these numbers against your actual 2011 gazette page once you
// confirm them — placeholders here are intentionally a bit looser than the
// 2016 table so the "older/newer rule" distinction is visible in results.
const FONT_HEIGHT_TABLE_2011: FontHeightRow[] = [
  { maxAreaCm2: 50, minHeightMm: 1.0 },
  { maxAreaCm2: 100, minHeightMm: 1.5 },
  { maxAreaCm2: 500, minHeightMm: 2.0 },
  { maxAreaCm2: 2500, minHeightMm: 3.0 },
  { maxAreaCm2: Infinity, minHeightMm: 4.0 },
]

// Table-I AS SUBSTITUTED by the 2016 amendment — these are the numbers that
// used to live directly in ruleConfig.ts before this refactor (confirmed
// against the "Table-I" page of your merged gazette PDF).
const FONT_HEIGHT_TABLE_2016: FontHeightRow[] = [
  { maxAreaCm2: 50, minHeightMm: 1.0 },
  { maxAreaCm2: 100, minHeightMm: 1.5 },
  { maxAreaCm2: 500, minHeightMm: 2.5 },
  { maxAreaCm2: 2500, minHeightMm: 4.0 },
  { maxAreaCm2: Infinity, minHeightMm: 6.0 },
]

const BASE_VALID_UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'cm', 'm', 'N']

// ---------------------------------------------------------------------------
// Ordered oldest -> newest. Add a new entry every time you re-ingest a PDF
// containing a further amendment, with that amendment's own notified
// effective date as `effectiveFrom`. resolveRuleVersion() walks this list and
// keeps the LAST entry whose effectiveFrom <= the product's effective date —
// so a product packed/launched in 2017 correctly resolves to "2016-amendment",
// not "2011-original", while a product from 2012 still resolves to 2011.
// ---------------------------------------------------------------------------
export const RULE_VERSIONS: RuleVersion[] = [
  {
    version: '2011-original',
    label: 'Legal Metrology (Packaged Commodities) Rules, 2011 (original notification)',
    effectiveFrom: '2011-03-01',
    mandatoryFields: BASE_MANDATORY_FIELDS,
    fontHeightTable: FONT_HEIGHT_TABLE_2011,
    validUnits: BASE_VALID_UNITS,
    legalQuerySuffix: '(2011 original notification, before Table-I amendment)',
  },
  {
    version: '2016-amendment',
    label: 'Legal Metrology (Packaged Commodities) (Amendment) Rules, 2016 — Table-I substituted',
    effectiveFrom: '2016-01-01',
    mandatoryFields: BASE_MANDATORY_FIELDS,
    fontHeightTable: FONT_HEIGHT_TABLE_2016,
    validUnits: BASE_VALID_UNITS,
    legalQuerySuffix: '(as substituted by the 2016 amendment, Table-I)',
  },
]

export function minHeightForArea(areaCm2: number, ruleVersion: RuleVersion): number {
  const row = ruleVersion.fontHeightTable.find((r) => areaCm2 < r.maxAreaCm2)
  return row ? row.minHeightMm : ruleVersion.fontHeightTable[ruleVersion.fontHeightTable.length - 1].minHeightMm
}

/**
 * Picks the rule version that was legally in force on `effectiveDate`.
 * Falls back to the earliest known version if the date predates everything
 * we've ingested (better to apply the oldest known rule than none at all —
 * it gets flagged for officer review either way if it doesn't fit).
 */
export function resolveRuleVersion(effectiveDate: Date): RuleVersion {
  const sorted = [...RULE_VERSIONS].sort(
    (a, b) => new Date(a.effectiveFrom).getTime() - new Date(b.effectiveFrom).getTime()
  )
  let chosen = sorted[0]
  for (const v of sorted) {
    if (new Date(v.effectiveFrom).getTime() <= effectiveDate.getTime()) {
      chosen = v
    } else {
      break
    }
  }
  return chosen
}

/**
 * The product's declared "packed_date" (MM/YYYY) is the closest thing this
 * system captures to when the product was put on the market, so THAT is
 * what determines which rule version applies — never today's date. A
 * product packed in 03/2012 must be checked against the 2011 rules even if
 * the inspection itself happens in 2026.
 *
 * If packed_date is missing or unparseable, this falls back to "now" so the
 * officer still gets a result instead of a hard failure — but that fallback
 * is surfaced back to the caller via `reason` so it's never silent.
 */
export function getEffectiveDateFromDeclaration(input: ProductDeclaration): { date: Date; reason: string } {
  const raw = input.packed_date
  const parsed = raw ? parsePackedDate(raw) : null
  if (parsed) {
    return {
      date: new Date(parsed.year, parsed.month - 1, 1),
      reason: `Rule version resolved from the declared packing date (${raw}).`,
    }
  }
  return {
    date: new Date(),
    reason: "Packed date was missing or not in a recognised MM/YYYY or YYYY/MM format, so today's date was used to pick a rule version — verify manually which version should actually apply.",
  }
}

export function parsePackedDate(raw: string): { month: number; year: number } | null {
  const match = /^\s*(\d{1,4})\s*[\/\-.\s]\s*(\d{1,4})\s*$/.exec(raw.trim())
  if (!match) return null
  const [, a, b] = match
  let month: number, year: number
  if (a.length === 4) { year = Number(a); month = Number(b) }
  else if (b.length === 4) { year = Number(b); month = Number(a) }
  else return null
  if (month < 1 || month > 12) return null
  return { month, year }
}