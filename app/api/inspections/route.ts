import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

function generateInspectionId() {
  const year = new Date().getFullYear()
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0')
  return `INS-${year}-${rand}`
}

// Maps a ComplianceResult['status'] onto the Inspection document's status enum.
function statusFromCompliance(status?: string) {
  if (status === 'COMPLIANT') return 'compliant'
  if (status === 'NON-COMPLIANT') return 'non_compliant'
  if (status === 'REVIEW REQUIRED') return 'review_required'
  return 'reviewed'
}

// The ONE place an inspection actually gets written to Mongo — called from
// NiyamAIApp's handleSaveCase, only after inspection details, capture,
// extraction, analysis and result have all been completed and the officer
// explicitly clicks "Save case" on the Report screen.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    const body = await req.json()
    const { inspectionType, premisesName, notes, location, fields, declaration, complianceResult, capturedImageUrl, readability } = body

    if (!premisesName) {
      return NextResponse.json({ error: 'premisesName is required.' }, { status: 400 })
    }

    await connectDB()

    const inspection = await Inspection.create({
      inspectionId: generateInspectionId(),
      officer: (session.user as any).id,
      inspectionType,
      premisesName,
      notes,
      location,
      fields,
      declaration,
      complianceResult,
      capturedImageUrl,
      readability,
      status: statusFromCompliance(complianceResult?.status),
    })

    return NextResponse.json({ inspection }, { status: 201 })
  } catch (err) {
    console.error('[inspections] save failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save inspection.' },
      { status: 500 }
    )
  }
}

// GET /api/inspections — repository list for the "Inspections" / History view.
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }
    await connectDB()

    const role = (session.user as any).role
    const userId = (session.user as any).id
    const city = (session.user as any).jurisdictionCity
    const state = (session.user as any).jurisdictionState

    let query: Record<string, unknown> = {}

    if (role === 'executive_officer') {
      query = { officer: userId }
    } else if (role === 'senior_officer') {
      const jurisdictionMatch: Record<string, unknown> = { passedToSeniorOfficer: true }
      if (city) jurisdictionMatch['location.city'] = city
      if (state) jurisdictionMatch['location.state'] = state
      query = { $or: [jurisdictionMatch, { reviewedBy: userId }] }
    }
    // role === 'admin' (or anything else) keeps query = {} i.e. everything

    const inspections = await Inspection.find(query)
      .select('inspectionId premisesName location declaration passedToSeniorOfficer reviewStatus rejectionReason createdAt status')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean({ flattenMaps: true })
    return NextResponse.json({ inspections })
  } catch (err) {
    console.error('[inspections] list failed:', err)
    return NextResponse.json({ error: 'Failed to load inspections.' }, { status: 500 })
  }
}
