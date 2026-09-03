import type { ProductDeclaration, RuleCheckResult } from './types'
import {
  MANDATORY_FIELDS,
  VALID_UNITS,
  CONSUMER_CARE_PHONE_REGEX,
  CONSUMER_CARE_EMAIL_REGEX,
  PIN_CODE_REGEX,
  PACKED_DATE_REGEX,
  CURRENCY_SYMBOLS,
  minHeightForArea,
} from './ruleConfig'

function pass(code: string, category: RuleCheckResult['category'], field: string, message: string, legalQuery: string): RuleCheckResult {
  return { code, category, field, severity: 'PASS', passed: true, confidence: 99, message, legalQuery }
}
function fail(
  code: string,
  category: RuleCheckResult['category'],
  field: string,
  severity: 'CRITICAL' | 'REVIEW_REQUIRED',
  confidence: number,
  message: string,
  legalQuery: string
): RuleCheckResult {
  return { code, category, field, severity, passed: false, confidence, message, legalQuery }
}

// --- Rule 6(1): mandatory declarations must be present -------------------
function checkMandatoryPresence(input: ProductDeclaration): RuleCheckResult[] {
  return MANDATORY_FIELDS.map(({ field, label, legalQuery }) => {
    const value = input[field]
    const present = value !== undefined && value !== null && value !== ''
    return present
      ? pass(`PRESENCE_${field}`, 'Mandatory declarations', field, `${label} declared.`, legalQuery)
      : fail(`PRESENCE_${field}`, 'Mandatory declarations', field, 'CRITICAL', 96, `${label} was not detected on the package.`, legalQuery)
  })
}

// --- Net quantity: valid unit + positive value ----------------------------
function checkNetQuantity(input: ProductDeclaration): RuleCheckResult[] {
  const nq = input.net_quantity
  if (!nq) return [] // already covered by mandatory-presence check

  const results: RuleCheckResult[] = []

  const unitOk = VALID_UNITS.includes(nq.unit)
  results.push(
    unitOk
      ? pass('NQ_UNIT', 'Format compliance', 'net_quantity.unit', `Unit "${nq.unit}" is a recognised standard unit.`, 'standard units of weight or measure rule 6')
      : fail('NQ_UNIT', 'Format compliance', 'net_quantity.unit', 'REVIEW_REQUIRED', 80, `Unit "${nq.unit}" is not in the recognised standard-unit list — verify manually.`, 'standard units of weight or measure rule 6')
  )

  const valueOk = typeof nq.value === 'number' && nq.value > 0
  results.push(
    valueOk
      ? pass('NQ_VALUE', 'Format compliance', 'net_quantity.value', 'Net quantity value is a valid positive number.', 'net quantity declaration rule 6')
      : fail('NQ_VALUE', 'Format compliance', 'net_quantity.value', 'CRITICAL', 95, 'Net quantity value is missing or not a positive number.', 'net quantity declaration rule 6')
  )

  return results
}

// --- Font height vs Rule 7(2) / Table-I -----------------------------------
function checkFontHeight(input: ProductDeclaration): RuleCheckResult | null {
  const nq = input.net_quantity
  if (!nq || nq.font_height_mm === undefined) return null

  const legalQuery = 'minimum height of numerals and letters Table-I rule 7'

  if (nq.principal_display_panel_area_cm2 === undefined) {
    // We know the required height depends on PDP area (Table-I), but the
    // capture/DL layer hasn't supplied that yet — flag for officer review
    // instead of silently passing or guessing.
    return fail(
      'FONT_HEIGHT_AREA_UNKNOWN',
      'Readability',
      'net_quantity.font_height_mm',
      'REVIEW_REQUIRED',
      87,
      `Font height (${nq.font_height_mm}mm) was detected, but Principal Display Panel area was not, so compliance against Table-I can't be confirmed automatically.`,
      legalQuery
    )
  }

  const required = minHeightForArea(nq.principal_display_panel_area_cm2)
  const compliant = nq.font_height_mm >= required

  return compliant
    ? pass('FONT_HEIGHT', 'Font analysis', 'net_quantity.font_height_mm', `${nq.font_height_mm}mm meets the ${required}mm minimum for this panel size.`, legalQuery)
    : fail(
        'FONT_HEIGHT',
        'Font analysis',
        'net_quantity.font_height_mm',
        'CRITICAL',
        92,
        `${nq.font_height_mm}mm is below the ${required}mm minimum required for a panel of this size.`,
        legalQuery
      )
}

// --- MRP: currency symbol + positive amount --------------------------------
function checkMRP(input: ProductDeclaration): RuleCheckResult[] {
  const mrp = input.mrp
  if (!mrp) return []

  const results: RuleCheckResult[] = []
  const currencyOk = mrp.currency ? CURRENCY_SYMBOLS.includes(mrp.currency.toLowerCase()) : false
  results.push(
    currencyOk
      ? pass('MRP_CURRENCY', 'Format compliance', 'mrp.currency', 'Currency symbol/marker present.', 'retail sale price inclusive of taxes declaration rule 6')
      : fail('MRP_CURRENCY', 'Format compliance', 'mrp.currency', 'REVIEW_REQUIRED', 75, 'MRP currency symbol not clearly recognised — verify "inclusive of all taxes" wording is present.', 'retail sale price inclusive of taxes declaration rule 6')
  )

  const amountOk = typeof mrp.amount === 'number' && mrp.amount > 0
  results.push(
    amountOk
      ? pass('MRP_AMOUNT', 'Format compliance', 'mrp.amount', 'MRP amount is a valid positive number.', 'retail sale price declaration rule 6')
      : fail('MRP_AMOUNT', 'Format compliance', 'mrp.amount', 'CRITICAL', 95, 'MRP amount is missing or not a positive number.', 'retail sale price declaration rule 6')
  )

  return results
}

// --- Manufacturer address completeness -------------------------------------
function checkManufacturer(input: ProductDeclaration): RuleCheckResult | null {
  if (!input.manufacturer) return null
  const hasPin = PIN_CODE_REGEX.test(input.manufacturer)
  const hasCommaSeparatedParts = input.manufacturer.split(',').length >= 2

  const complete = hasPin && hasCommaSeparatedParts
  return complete
    ? pass('MANUFACTURER_ADDRESS', 'Data consistency', 'manufacturer', 'Manufacturer name and address appear complete (includes PIN code).', 'name and address of manufacturer rule 6')
    : fail(
        'MANUFACTURER_ADDRESS',
        'Data consistency',
        'manufacturer',
        'REVIEW_REQUIRED',
        78,
        'Manufacturer declaration may be missing a complete address or PIN code — verify manually.',
        'name and address of manufacturer rule 6'
      )
}

// --- Packed date: valid MM/YYYY, not in the future --------------------------
function checkPackedDate(input: ProductDeclaration): RuleCheckResult | null {
  if (!input.packed_date) return null
  const match = PACKED_DATE_REGEX.exec(input.packed_date)
  if (!match) {
    return fail('PACKED_DATE_FORMAT', 'Format compliance', 'packed_date', 'REVIEW_REQUIRED', 82, `"${input.packed_date}" is not in the expected MM/YYYY format.`, 'month and year of manufacture or packing declaration rule 6')
  }

  const [, month, year] = match
  const declaredDate = new Date(Number(year), Number(month) - 1, 1)
  const now = new Date()
  const inFuture = declaredDate.getTime() > new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  return inFuture
    ? fail('PACKED_DATE_FUTURE', 'Data consistency', 'packed_date', 'CRITICAL', 90, `Packed date "${input.packed_date}" is in the future.`, 'month and year of manufacture or packing declaration rule 6')
    : pass('PACKED_DATE', 'Format compliance', 'packed_date', 'Packed date is validly formatted and not in the future.', 'month and year of manufacture or packing declaration rule 6')
}

// --- Consumer care: needs at least a phone or an email ----------------------
function checkConsumerCare(input: ProductDeclaration): RuleCheckResult | null {
  if (!input.consumer_care) return null
  const hasPhone = CONSUMER_CARE_PHONE_REGEX.test(input.consumer_care)
  const hasEmail = CONSUMER_CARE_EMAIL_REGEX.test(input.consumer_care)

  return hasPhone || hasEmail
    ? pass('CONSUMER_CARE_FORMAT', 'Format compliance', 'consumer_care', 'Consumer care details include a valid phone number and/or email.', 'consumer care email id and phone number declaration')
    : fail('CONSUMER_CARE_FORMAT', 'Format compliance', 'consumer_care', 'REVIEW_REQUIRED', 80, 'Consumer care text was detected but no valid phone number or email could be parsed from it.', 'consumer care email id and phone number declaration')
}

// --- Imported-goods extras ----------------------------------------------------
function checkImportRequirements(input: ProductDeclaration): RuleCheckResult | null {
  if (!input.is_imported) return null
  return input.country_of_origin
    ? pass('COUNTRY_OF_ORIGIN', 'Mandatory declarations', 'country_of_origin', 'Country of origin declared for imported product.', 'country of origin declaration imported package rule 6')
    : fail('COUNTRY_OF_ORIGIN', 'Mandatory declarations', 'country_of_origin', 'CRITICAL', 94, 'Product is marked as imported but no country of origin was declared.', 'country of origin declaration imported package rule 6')
}

export function runComplianceChecks(input: ProductDeclaration): RuleCheckResult[] {
  const checks: (RuleCheckResult | null)[] = [
    ...checkMandatoryPresence(input),
    ...checkNetQuantity(input),
    checkFontHeight(input),
    ...checkMRP(input),
    checkManufacturer(input),
    checkPackedDate(input),
    checkConsumerCare(input),
    checkImportRequirements(input),
  ]
  return checks.filter((c): c is RuleCheckResult => c !== null)
}