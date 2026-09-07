import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

export const runtime = 'nodejs'

const MICROSERVICE_URL = process.env.MICROSERVICE_URL || 'http://localhost:8000'

// POST /api/microservice/extract-field
// FormData: { inspectionId: string, fieldName: string, image: File }
// Used by the "capture that part again" option on a missing declaration.
export async function POST(req: Request) {
  const form = await req.formData()
  const inspectionId = form.get('inspectionId') as string | null
  const fieldName = form.get('fieldName') as string | null
  const image = form.get('image') as File | null

  if (!inspectionId || !fieldName || !image) {
    return NextResponse.json({ error: 'inspectionId, fieldName and image are required' }, { status: 400 })
  }

  const forwardForm = new FormData()
  forwardForm.append('field_name', fieldName)
  forwardForm.append('file', image, image.name || 'recapture.jpg')

  const msRes = await fetch(`${MICROSERVICE_URL}/extract-field`, { method: 'POST', body: forwardForm })
  if (!msRes.ok) {
    const text = await msRes.text().catch(() => '')
    return NextResponse.json({ error: `Microservice error: ${text}` }, { status: 502 })
  }
  const msJson = await msRes.json()
  const stillMissing = msJson.value === null || msJson.value === undefined

  const fieldRecord = {
    value: msJson.value ?? null,
    confidence: msJson.confidence ?? 0,
    source: msJson.source || 'recapture_llm_crop',
    // Still not legible after a recapture -> the frontend falls back to
    // "type manually" or "not applicable" only, per the spec.
    status: stillMissing ? 'missing' : 'extracted',
    reason: stillMissing ? msJson.reason || 'Still not legible after recapture' : null,
  }

  await connectDB()
  const inspection = await Inspection.findOne({ inspectionId })
  if (inspection) {
    ;(inspection.fields as any).set
      ? (inspection.fields as any).set(fieldName, fieldRecord)
      : ((inspection.fields as any)[fieldName] = fieldRecord)
    inspection.markModified('fields')
    await inspection.save()
  }

  return NextResponse.json({ field: fieldRecord })
}
