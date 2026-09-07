import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

// GET /api/inspections/:id
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  await connectDB()
  const inspection = await Inspection.findOne({ inspectionId: params.id })
  if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ inspection })
}

// PATCH /api/inspections/:id
// Body can update any of: notes, status, complianceResult, or a single field
// override, e.g. { field: { name: "consumer_care", status: "manual" | "not_applicable", value } }
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  await connectDB()
  const body = await req.json()
  const inspection = await Inspection.findOne({ inspectionId: params.id })
  if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.notes !== undefined) inspection.notes = body.notes
  if (body.status !== undefined) inspection.status = body.status
  if (body.complianceResult !== undefined) inspection.complianceResult = body.complianceResult

  // Manual entry or "Not applicable" for one missing field, chosen from the
  // 3-option prompt on the Extraction screen.
  if (body.field?.name) {
    const { name, status, value } = body.field as { name: string; status: 'manual' | 'not_applicable'; value?: string }
    const current = (inspection.fields as any).get?.(name) || (inspection.fields as any)[name] || {}
    const updated = {
      ...current,
      status,
      value: status === 'not_applicable' ? null : value ?? null,
      confidence: status === 'manual' ? 1 : current.confidence || 0,
      source: status === 'manual' ? 'manual' : current.source || null,
      reason: status === 'not_applicable' ? 'Marked not applicable by officer' : null,
    }
    ;(inspection.fields as any).set ? (inspection.fields as any).set(name, updated) : ((inspection.fields as any)[name] = updated)
    inspection.markModified('fields')
  }

  await inspection.save()
  return NextResponse.json({ inspection })
}
