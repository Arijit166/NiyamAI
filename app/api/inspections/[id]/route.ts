import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await connectDB()
    const inspection = await Inspection.findOne({ inspectionId: params.id }).lean()
    if (!inspection) {
      return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
    }
    return NextResponse.json({ inspection })
  } catch (err) {
    console.error('[inspections/:id] fetch failed:', err)
    return NextResponse.json({ error: 'Failed to load inspection.' }, { status: 500 })
  }
}
