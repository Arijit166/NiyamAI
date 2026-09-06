// Non-versioned constants only. MANDATORY_FIELDS, FONT_HEIGHT_TABLE,
// minHeightForArea and VALID_UNITS used to live here, but those DO change
// between amendments (that's the whole point of the versioning feature), so
// they now live in ./ruleVersions.ts as part of a dated RuleVersion. This
// file keeps only the things that are format/regex rules, not legal
// thresholds that get amended over time.
export { resolveRuleVersion, getEffectiveDateFromDeclaration, minHeightForArea, RULE_VERSIONS } from './ruleVersions'
export type { RuleVersion } from './ruleVersions'

export const CONSUMER_CARE_PHONE_REGEX = /(\+?91[-\s]?)?[6-9]\d{9}|1800[-\s]?\d{3,4}[-\s]?\d{4}/
export const CONSUMER_CARE_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
export const PIN_CODE_REGEX = /\b\d{6}\b/
export const CURRENCY_SYMBOLS = ['₹', 'rs', 'inr', 'rupee']
export { parsePackedDate } from './ruleVersions'
