import type { ProductDeclaration, ComplianceResult, Violation, RuleCheckResult, CheckCategory } from '../rules/types'
import { runComplianceChecks } from '../rules/ruleEngine'
import { findLegalBasis } from '../rag/legalBasis'
import { resolveRuleVersion, getEffectiveDateFromDeclaration, type RuleVersion } from '../rules/ruleVersions'

// Score weights per severity. This is a prototype scoring scheme, not
// something derived from the gazette PDF — tune once your department
// finalizes how violations should be weighted.
const SEVERITY_PENALTY: Record<'CRITICAL' | 'REVIEW_REQUIRED', number> = {
  CRITICAL: 15,
  REVIEW_REQUIRED: 7,
}

function computeScore(checks: RuleCheckResult[]): number {
  const penalty = checks
    .filter((c) => !c.passed)
    .reduce((sum, c) => sum + SEVERITY_PENALTY[c.severity as 'CRITICAL' | 'REVIEW_REQUIRED'], 0)
  return Math.max(0, Math.min(100, 100 - penalty))
}

function computeStatus(checks: RuleCheckResult[], score: number): ComplianceResult['status'] {
  const hasCritical = checks.some((c) => c.severity === 'CRITICAL' && !c.passed)
  if (hasCritical && score < 60) return 'NON-COMPLIANT'
  if (checks.some((c) => !c.passed)) return 'REVIEW REQUIRED'
  return 'COMPLIANT'
}

function computeBreakdown(checks: RuleCheckResult[]): ComplianceResult['breakdown'] {
  const byCategory = new Map<CheckCategory, { pass: number; total: number }>()
  for (const c of checks) {
    const bucket = byCategory.get(c.category) ?? { pass: 0, total: 0 }
    bucket.total += 1
    if (c.passed) bucket.pass += 1
    byCategory.set(c.category, bucket)
  }
  return Array.from(byCategory.entries()).map(([label, { pass, total }]) => ({
    label,
    value: total === 0 ? 100 : Math.round((pass / total) * 100),
  }))
}

async function buildViolation(check: RuleCheckResult, ruleVersion: RuleVersion): Promise<Violation> {
  // Bias retrieval toward the gazette pages for the rule version that was
  // actually applied, so citations don't accidentally point at a
  // since-superseded clause from a different amendment.
  const versionedQuery = `${check.legalQuery} ${ruleVersion.legalQuerySuffix}`
  const legalBasis = await findLegalBasis(versionedQuery)
  return {
    tag: check.severity === 'CRITICAL' ? 'CRITICAL' : 'REVIEW REQUIRED',
    title: check.message,
    description: `${check.field} — ${check.category.toLowerCase()} check failed.`,
    confidence: `${check.confidence}%`,
    category: check.category,
    legalBasis: legalBasis.map((c) => ({
      ruleRefs: c.ruleRefs,
      snippet: c.snippet,
      page: c.page,
      sourceFile: c.sourceFile,
    })),
  }
}

// Ties the deterministic rule engine to the RAG citation layer, producing
// the ComplianceResult shape the /api/compliance/evaluate route (and the
// ResultView UI) expect.
//
// NEW: before running any checks, this resolves WHICH dated rule version
// applies to this specific product (based on its packed/launch date) so a
// product from 2017 is checked against the 2016 amendment, not whatever the
// engine's static defaults used to be, while an older product from 2012 is
// still checked against the 2011 original.
export async function evaluateCompliance(input: ProductDeclaration): Promise<ComplianceResult> {
  const { date: effectiveDate, reason } = getEffectiveDateFromDeclaration(input)
  const ruleVersion = resolveRuleVersion(effectiveDate)

  const checks = runComplianceChecks(input, ruleVersion)
  const failedChecks = checks.filter((c) => !c.passed)

  // Each failed check's citation lookup is an independent vector search —
  // no need to serialize them.
  const violations = await Promise.all(failedChecks.map((c) => buildViolation(c, ruleVersion)))
  const score = computeScore(checks)

  return {
    score,
    status: computeStatus(checks, score),
    breakdown: computeBreakdown(checks),
    violations,
    checks,
    appliedRuleVersion: {
      version: ruleVersion.version,
      label: ruleVersion.label,
      effectiveFrom: ruleVersion.effectiveFrom,
      reason,
    },
  }
}
