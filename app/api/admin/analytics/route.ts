import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

// GET /api/admin/analytics
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    await connectDB()

    const rows = await Inspection.find(
      {},
      {
        status: 1,
        'complianceResult.status': 1,
        'complianceResult.violations': 1,
        'location.state': 1,
        'declaration.company_name': 1,
        'declaration.product_name': 1, // NEW — needed for the company+product ranking below
        premisesName: 1,
        createdAt: 1,
      }
    ).lean({ flattenMaps: true })

    const trendMap = new Map<string, { inspections: number; violations: number }>()
    const violationCounts = new Map<string, number>()
    const stateMap = new Map<string, { total: number; compliant: number; nonCompliant: number; reviewRequired: number }>()
    const companyNonCompliant = new Map<string, number>()
    // NEW — company+product pairs, ranked by total violation count across all their inspections.
    const companyProductMap = new Map<string, { company: string; product: string; totalInspections: number; totalViolations: number }>()

    for (const r of rows as any[]) {
      const created = new Date(r.createdAt)
      const monthKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`
      const violations = r.complianceResult?.violations || []

      const t = trendMap.get(monthKey) || { inspections: 0, violations: 0 }
      t.inspections += 1
      t.violations += violations.length
      trendMap.set(monthKey, t)

      for (const v of violations) {
        if (!v?.title) continue
        violationCounts.set(v.title, (violationCounts.get(v.title) || 0) + 1)
      }

      const stateName = r.location?.state || 'Unknown'
      const st = stateMap.get(stateName) || { total: 0, compliant: 0, nonCompliant: 0, reviewRequired: 0 }
      st.total += 1
      const status = r.complianceResult?.status
      if (status === 'COMPLIANT') st.compliant += 1
      else if (status === 'NON-COMPLIANT') st.nonCompliant += 1
      else if (status === 'REVIEW REQUIRED') st.reviewRequired += 1
      stateMap.set(stateName, st)

      const companyName = r.declaration?.company_name || r.premisesName || 'Unknown company'

      if (status === 'NON-COMPLIANT') {
        companyNonCompliant.set(companyName, (companyNonCompliant.get(companyName) || 0) + 1)
      }

      // NEW — accumulate every inspection (not just non-compliant ones) per
      // company+product pair, so the ranking reflects total violation counts
      // found across all of that product's inspections.
      const productName = r.declaration?.product_name || 'Unnamed product'
      const cpKey = `${companyName}|||${productName}`
      const cp = companyProductMap.get(cpKey) || { company: companyName, product: productName, totalInspections: 0, totalViolations: 0 }
      cp.totalInspections += 1
      cp.totalViolations += violations.length
      companyProductMap.set(cpKey, cp)
    }

    const violationTrends = Array.from(trendMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, v]) => ({ month, ...v }))

    const mostCommonViolations = Array.from(violationCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, count]) => ({ title, count }))

    const stateWiseCompliance = Array.from(stateMap.entries())
      .map(([state, s]) => ({
        state,
        total: s.total,
        compliant: s.compliant,
        nonCompliant: s.nonCompliant,
        reviewRequired: s.reviewRequired,
        complianceRate: s.total ? Math.round((s.compliant / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)

    const repeatViolators = Array.from(companyNonCompliant.entries())
      .filter(([, count]) => count >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([company, count]) => ({ company, nonCompliantCount: count }))

    // NEW — company + product, sorted by total violations descending.
    const companyProductViolations = Array.from(companyProductMap.values())
      .sort((a, b) => b.totalViolations - a.totalViolations)

    return NextResponse.json({
      violationTrends,
      mostCommonViolations,
      stateWiseCompliance,
      repeatViolators,
      companyProductViolations, // NEW
    })
  } catch (err) {
    console.error('[admin/analytics] failed:', err)
    return NextResponse.json({ error: 'Failed to load analytics.' }, { status: 500 })
  }
}