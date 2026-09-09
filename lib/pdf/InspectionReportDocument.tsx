import { Document, Page, Text, View, StyleSheet } from '@react-pdf/renderer'
import type { ProductDeclaration, ComplianceResult } from '@/lib/rules/types'

export interface InspectionReportProps {
  inspectionId?: string
  premisesName?: string
  location?: string
  officerName?: string
  inspectionType?: string
  generatedAt?: string
  declaration: ProductDeclaration
  result: ComplianceResult
  readability?: any
}

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: 'Helvetica', color: '#0f172a' },
  header: { marginBottom: 16, borderBottom: '2px solid #0ea5e9', paddingBottom: 10 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 2 },
  subtitle: { fontSize: 9, color: '#64748b' },
  metaGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  metaItem: { width: '50%', marginBottom: 6 },
  metaLabel: { fontSize: 8, color: '#64748b', textTransform: 'uppercase' },
  metaValue: { fontSize: 10, fontWeight: 700 },
  versionBox: { marginBottom: 10, padding: 8, backgroundColor: '#f0f9ff', borderRadius: 4 },
  versionEyebrow: { fontSize: 8, color: '#0369a1', textTransform: 'uppercase' },
  versionLabel: { fontSize: 10, fontWeight: 700, color: '#0c4a6e' },
  versionReason: { fontSize: 8, color: '#0369a1', marginTop: 2 },
  sectionTitle: { fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 6, color: '#0ea5e9' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  scoreBox: {
    width: 70,
    height: 70,
    borderRadius: 35,
    border: '4px solid #0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  scoreNum: { fontSize: 20, fontWeight: 700 },
  statusBadge: { fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 4 },
  table: { display: 'flex', width: '100%', marginBottom: 10 },
  tableRow: { flexDirection: 'row', borderBottom: '1px solid #e2e8f0', paddingVertical: 4 },
  tableCellLabel: { width: '35%', fontSize: 9, color: '#475569' },
  tableCellValue: { width: '65%', fontSize: 9, fontWeight: 700 },
  violationCard: { border: '1px solid #e2e8f0', borderLeft: '4px solid #ef4444', padding: 8, marginBottom: 8, borderRadius: 4 },
  violationCardWarn: { borderLeftColor: '#f59e0b' },
  violationTitle: { fontSize: 10, fontWeight: 700, marginBottom: 2 },
  violationDesc: { fontSize: 9, color: '#475569', marginBottom: 3 },
  citation: { fontSize: 8, color: '#0ea5e9', marginTop: 2 },
  footer: {
    position: 'absolute',
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 8,
    color: '#94a3b8',
    borderTop: '1px solid #e2e8f0',
    paddingTop: 6,
  },
})

function statusColor(status: ComplianceResult['status']) {
  if (status === 'COMPLIANT') return { bg: '#dcfce7', fg: '#166534' }
  if (status === 'NON-COMPLIANT') return { bg: '#fee2e2', fg: '#991b1b' }
  return { bg: '#fef3c7', fg: '#92400e' }
}

export function InspectionReportDocument({
  inspectionId, premisesName, location, officerName, inspectionType, generatedAt, declaration, result, readability,
}: InspectionReportProps) {
  const tone = statusColor(result.status)
  const appliedVersion = result.appliedRuleVersion
  const overall = readability?.overall_readability

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>NiyamAI — Compliance Inspection Report</Text>
          <Text style={styles.subtitle}>
            Legal Metrology (Packaged Commodities) Rules — AI-assisted, rule-engine-validated inspection
          </Text>
        </View>

        <View style={styles.metaGrid}>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Inspection ID</Text>
            <Text style={styles.metaValue}>{inspectionId || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Generated</Text>
            <Text style={styles.metaValue}>{generatedAt || new Date().toLocaleString()}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Premises</Text>
            <Text style={styles.metaValue}>{premisesName || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Location</Text>
            <Text style={styles.metaValue}>{location || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Inspection type</Text>
            <Text style={styles.metaValue}>{inspectionType || '—'}</Text>
          </View>
          <View style={styles.metaItem}>
            <Text style={styles.metaLabel}>Officer</Text>
            <Text style={styles.metaValue}>{officerName || '—'}</Text>
          </View>
        </View>

        {appliedVersion && (
          <View style={styles.versionBox}>
            <Text style={styles.versionEyebrow}>Rule version applied</Text>
            <Text style={styles.versionLabel}>{appliedVersion.label}</Text>
            <Text style={styles.versionReason}>{appliedVersion.reason}</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Declared product details</Text>
        <View style={styles.table}>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Product name</Text>
            <Text style={styles.tableCellValue}>{declaration.product_name || '—'}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Company name</Text>
            <Text style={styles.tableCellValue}>{declaration.company_name || '—'}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Net quantity</Text>
            <Text style={styles.tableCellValue}>
              {declaration.net_quantity ? `${declaration.net_quantity.value} ${declaration.net_quantity.unit}` : '—'}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>MRP</Text>
            <Text style={styles.tableCellValue}>
              {declaration.mrp ? `Rs. ${declaration.mrp.amount}` : '—'}
            </Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>MRP inclusive of all taxes</Text>
            <Text style={styles.tableCellValue}>{declaration.mrp_tax_inclusive || '—'}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Manufacturer</Text>
            <Text style={styles.tableCellValue}>{declaration.manufacturer || '—'}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Packed date</Text>
            <Text style={styles.tableCellValue}>{declaration.packed_date || '—'}</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.tableCellLabel}>Consumer care</Text>
            <Text style={styles.tableCellValue}>{declaration.consumer_care || '—'}</Text>
          </View>
          {declaration.is_imported && (
            <View style={styles.tableRow}>
              <Text style={styles.tableCellLabel}>Country of origin</Text>
              <Text style={styles.tableCellValue}>{declaration.country_of_origin || '—'}</Text>
            </View>
          )}
        </View>

        <Text style={styles.sectionTitle}>Compliance score</Text>
        <View style={styles.scoreRow}>
          <View style={styles.scoreBox}>
            <Text style={styles.scoreNum}>{result.score}</Text>
          </View>
          <Text style={[styles.statusBadge, { backgroundColor: tone.bg, color: tone.fg }]}>{result.status}</Text>
        </View>

        {(() => {
          const fontCheck = result.checks?.find((c) => c.code === 'FONT_HEIGHT' || c.code === 'FONT_HEIGHT_AREA_UNKNOWN')
          if (!fontCheck) return null
          return (
            <>
              <Text style={styles.sectionTitle}>Numeral / letter height check</Text>
              <Text style={{ fontSize: 9, color: fontCheck.passed ? '#166534' : '#991b1b', marginBottom: 10 }}>
                {fontCheck.message}
              </Text>
            </>
          )
        })()}

        <Text style={styles.sectionTitle}>Findings ({result.violations.length})</Text>
        {result.violations.length === 0 && (
          <Text style={{ fontSize: 9, color: '#166534' }}>
            All mandatory Legal Metrology rules were satisfied for the applicable rule version.
          </Text>
        )}
        {result.violations.map((v, i) => (
          <View key={i} style={[styles.violationCard, v.tag !== 'CRITICAL' ? styles.violationCardWarn : {}]}>
            <Text style={styles.violationTitle}>
              [{v.tag}] {v.title}
            </Text>
            <Text style={styles.violationDesc}>
              {v.description} — confidence {v.confidence}
            </Text>
            {v.legalBasis.map((b, j) => (
              <Text key={j} style={styles.citation}>
                Ref: {b.ruleRefs.join(', ') || 'Unspecified rule'} — {b.sourceFile}, p.{b.page}
              </Text>
            ))}
          </View>
        ))}
        {overall && (
          <>
            <Text style={styles.sectionTitle}>Photo readability</Text>
            <View style={styles.tableRow}>
              <Text style={styles.tableCellLabel}>Readability score</Text>
              <Text style={styles.tableCellValue}>{overall.score}/100 ({overall.grade})</Text>
            </View>
            {overall.major_issue && (
              <View style={styles.tableRow}>
                <Text style={styles.tableCellLabel}>Primary issue</Text>
                <Text style={styles.tableCellValue}>{overall.major_issue}</Text>
              </View>
            )}
            {overall.retake_required && (
              <Text style={{ fontSize: 9, color: '#991b1b', marginTop: 4 }}>
                Retake recommended before relying on this evidence.
              </Text>
            )}
          </>
        )}

        <Text style={styles.footer}>
          Generated by NiyamAI. AI identifies declarations; the deterministic rule engine performs validation. This
          report requires human officer sign-off before enforcement action.
        </Text>
      </Page>
    </Document>
  )
}
