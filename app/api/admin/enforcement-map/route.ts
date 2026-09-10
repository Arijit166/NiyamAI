import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

// GET /api/admin/enforcement-map
// Builds a state -> city -> company hierarchy of inspection/violation counts
// for the India Enforcement Map. Admin-only.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    await connectDB()

    const rows = await Inspection.find(
      { 'location.state': { $exists: true, $ne: '' } },
      {
        inspectionId: 1,
        'location.state': 1,
        'location.city': 1,
        'location.address': 1,
        'location.lat': 1,
        'location.lng': 1,
        'declaration.company_name': 1,
        premisesName: 1,
        status: 1,
        'complianceResult.status': 1,
        'complianceResult.score': 1,
        'complianceResult.violations': 1,
        createdAt: 1,
      }
    ).lean({ flattenMaps: true })

    type CompanyAgg = { company: string; totalInspections: number; totalViolations: number; violationTypes: Set<string>; history: any[] }
    type CityAgg = { city: string; totalInspections: number; totalViolations: number; latitudeTotal: number; longitudeTotal: number; coordinateCount: number; companies: Map<string, CompanyAgg> }
    type StateAgg = { state: string; totalInspections: number; totalViolations: number; cities: Map<string, CityAgg> }

    const states = new Map<string, StateAgg>()

    for (const r of rows as any[]) {
      const stateName = r.location?.state || 'Unknown'
      const cityName = String(r.location?.city || r.location?.address?.split(',')[0] || 'Unknown').trim()
      const companyName = r.declaration?.company_name || r.premisesName || 'Unknown company'
      const violations = r.complianceResult?.violations || []

      if (!states.has(stateName)) states.set(stateName, { state: stateName, totalInspections: 0, totalViolations: 0, cities: new Map() })
      const s = states.get(stateName)!
      s.totalInspections += 1
      s.totalViolations += violations.length

      if (!s.cities.has(cityName)) s.cities.set(cityName, { city: cityName, totalInspections: 0, totalViolations: 0, latitudeTotal: 0, longitudeTotal: 0, coordinateCount: 0, companies: new Map() })
      const c = s.cities.get(cityName)!
      c.totalInspections += 1
      c.totalViolations += violations.length
      if (typeof r.location?.lat === 'number' && typeof r.location?.lng === 'number') {
        c.latitudeTotal += r.location.lat
        c.longitudeTotal += r.location.lng
        c.coordinateCount += 1
      }

      if (!c.companies.has(companyName)) c.companies.set(companyName, { company: companyName, totalInspections: 0, totalViolations: 0, violationTypes: new Set(), history: [] })
      const co = c.companies.get(companyName)!
      co.totalInspections += 1
      co.totalViolations += violations.length
      for (const v of violations) if (v?.title) co.violationTypes.add(v.title)
      co.history.push({
        id: r._id,
        inspectionId: r.inspectionId,
        date: r.createdAt,
        status: r.complianceResult?.status || r.status,
        score: r.complianceResult?.score ?? null,
        violations,
      })
    }

    const result = Array.from(states.values()).map((s) => ({
      state: s.state,
      totalInspections: s.totalInspections,
      totalViolations: s.totalViolations,
      cities: Array.from(s.cities.values()).map((c) => ({
        city: c.city,
        totalInspections: c.totalInspections,
        totalViolations: c.totalViolations,
        latitude: c.coordinateCount > 0 ? c.latitudeTotal / c.coordinateCount : null,
        longitude: c.coordinateCount > 0 ? c.longitudeTotal / c.coordinateCount : null,
        companies: Array.from(c.companies.values()).map((co) => ({
          company: co.company,
          totalInspections: co.totalInspections,
          totalViolations: co.totalViolations,
          violationTypes: Array.from(co.violationTypes),
          history: co.history.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
        })),
      })),
    }))

    return NextResponse.json({ states: result })
  } catch (err) {
    console.error('[admin/enforcement-map] failed:', err)
    return NextResponse.json({ error: 'Failed to load enforcement map data.' }, { status: 500 })
  }
}