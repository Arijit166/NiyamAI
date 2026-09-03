// Deterministic thresholds pulled from the gazette PDF you uploaded.
// IMPORTANT: your PDF is 194 pages of *amendment* notifications to the
// Legal Metrology (Packaged Commodities) Rules, 2011 — not one clean
// consolidated rulebook. Numbers below were confirmed against specific
// pages during setup (cited in comments) but rules get amended again.
// Treat this file as the "current known state" and re-check it against
// findLegalBasis() output whenever you re-ingest a newer merged PDF.

// Rule 6(1): mandatory declarations every retail package must carry.
export const MANDATORY_FIELDS: { field: keyof import('./types').ProductDeclaration; label: string; legalQuery: string }[] = [
  { field: 'product_name', label: 'Product name / common generic name', legalQuery: 'common or generic name of commodity declaration rule 6' },
  { field: 'net_quantity', label: 'Net quantity', legalQuery: 'net quantity declaration standard unit rule 6' },
  { field: 'mrp', label: 'Maximum Retail Price (MRP)', legalQuery: 'retail sale price inclusive of taxes declaration rule 6' },
  { field: 'manufacturer', label: 'Manufacturer / packer / importer name and address', legalQuery: 'name and address of manufacturer packer importer rule 6' },
  { field: 'packed_date', label: 'Month and year of manufacture / packing / import', legalQuery: 'month and year of manufacture or packing declaration rule 6' },
  { field: 'consumer_care', label: 'Consumer care details', legalQuery: 'consumer care email id and phone number declaration' },
]

// Rule 7(2) + Table-I (as substituted — found on the "Table-I" page of your
// PDF): minimum numeral/letter height by Principal Display Panel area.
export const FONT_HEIGHT_TABLE: { maxAreaCm2: number; minHeightMm: number }[] = [
  { maxAreaCm2: 50, minHeightMm: 1.0 },
  { maxAreaCm2: 100, minHeightMm: 1.5 },
  { maxAreaCm2: 500, minHeightMm: 2.5 },
  { maxAreaCm2: 2500, minHeightMm: 4.0 },
  { maxAreaCm2: Infinity, minHeightMm: 6.0 },
]

export function minHeightForArea(areaCm2: number): number {
  const row = FONT_HEIGHT_TABLE.find((r) => areaCm2 < r.maxAreaCm2)
  return row ? row.minHeightMm : FONT_HEIGHT_TABLE[FONT_HEIGHT_TABLE.length - 1].minHeightMm
}

// Rule 6 read with the standard-units schedule. Extend as you find more
// approved units in the PDF (e.g. via findLegalBasis('standard units of weight measure')).
export const VALID_UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'cm', 'm', 'N'] // N = count / number

export const CONSUMER_CARE_PHONE_REGEX = /(\+?91[-\s]?)?[6-9]\d{9}|1800[-\s]?\d{3,4}[-\s]?\d{4}/
export const CONSUMER_CARE_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
export const PIN_CODE_REGEX = /\b\d{6}\b/
export const PACKED_DATE_REGEX = /^(0[1-9]|1[0-2])\/(\d{4})$/
export const CURRENCY_SYMBOLS = ['₹', 'rs', 'inr', 'rupee']