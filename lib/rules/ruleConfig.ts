export { resolveRuleVersion, getEffectiveDateFromDeclaration, minHeightForArea, RULE_VERSIONS } from './ruleVersions'
export type { RuleVersion } from './ruleVersions'

export const CONSUMER_CARE_PHONE_REGEX = /(\+?91[-\s]?)?[6-9]\d{9}|1800[-\s]?\d{3,4}[-\s]?\d{4}/
export const CONSUMER_CARE_EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/
export const PIN_CODE_REGEX = /\b\d{6}\b/
export const CURRENCY_SYMBOLS = ['₹', 'rs', 'inr', 'rupee']
export { parsePackedDate } from './ruleVersions'
