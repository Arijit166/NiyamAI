import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

async function nextInspectionId() {
  const year = new Date().getFullYear()
  const count = await Inspection.countDocuments({
    inspectionId: { $regex: `^INS-${year}-` },
  })
  const seq = String(count + 1).padStart(5, '0')
  return `INS-${year}-${seq}`
}

// POST /api/inspections -> create a new (dynamic) inspection record.
// Body: { inspectionType, location: {address, lat?, lng?}, premisesName, notes }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await req.json()
  await connectDB()

  const inspectionId = await nextInspectionId()

  const inspection = await Inspection.create({
    inspectionId,
    officer: (session.user as any).id,
    inspectionType: body.inspectionType || 'Physical store',
    location: body.location || { address: '' },
    premisesName: body.premisesName || '',
    notes: body.notes || '',
    status: 'draft',
    fields: {},
  })

  return NextResponse.json({ inspection })
}

// GET /api/inspections -> list inspections for the repository/history view
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  await connectDB()
  const inspections = await Inspection.find().sort({ createdAt: -1 }).limit(100).populate('officer', 'name')
  return NextResponse.json({ inspections })
}
