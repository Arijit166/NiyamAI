import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

export const runtime = 'nodejs' // needed for multipart/form-data handling

const MICROSERVICE_URL = process.env.MICROSERVICE_URL || 'http://localhost:8000'

// The microservice represents "nothing detected" as the literal string
// "UNKNOWN" (see ocr.py's build_reliable_output), not JSON null/undefined.
// Treat that — plus empty/whitespace strings — as missing too.
function isMissingValue(v: unknown): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') {
    const trimmed = v.trim()
    if (!trimmed) return true
    if (trimmed.toUpperCase() === 'UNKNOWN') return true
  }
  return false
}

// POST /api/microservice/extract
// FormData: { inspectionId: string, image: File }
// Single-capture flow: exactly one package photo, no multi-surface set.
export async function POST(req: Request) {
  const form = await req.formData()
  const inspectionId = form.get('inspectionId') as string | null
  const image = form.get('image') as File | null

  if (!inspectionId || !image) {
    return NextResponse.json({ error: 'inspectionId and image are required' }, { status: 400 })
  }

  const forwardForm = new FormData()
  forwardForm.append('file', image, image.name || 'capture.jpg')

  const msRes = await fetch(`${MICROSERVICE_URL}/extract`, { method: 'POST', body: forwardForm })
  if (!msRes.ok) {
    const text = await msRes.text().catch(() => '')
    return NextResponse.json({ error: `Microservice error: ${text}` }, { status: 502 })
  }
  const msJson = await msRes.json()
  const structuredData = msJson?.result?.structured_data || {}

  // Map the microservice's {value, confidence, reason, manual_review,
  // validation_reason} shape onto our per-field record used by the
  // Extraction screen's missing-field UI.
  const fields: Record<string, any> = {}
  for (const [name, entry] of Object.entries<any>(structuredData)) {
    const missing = isMissingValue(entry.value)
    fields[name] = {
      value: missing ? null : String(entry.value),
      confidence: entry.confidence ?? 0,
      source: null,
      status: missing ? 'missing' : 'extracted',
      reason: missing ? entry.reason || 'Not detected' : entry.validation_reason || null,
    }
  }

  // product_name lives at the TOP LEVEL of the microservice's response
  // (output_payload["product_name"] in ocr.py), not inside structured_data —
  // pull it in separately so it isn't silently dropped.
  const productName = msJson?.result?.product_name
  fields['product_name'] = {
    value: isMissingValue(productName) ? null : String(productName),
    confidence: 0,
    source: null,
    status: isMissingValue(productName) ? 'missing' : 'extracted',
    reason: isMissingValue(productName) ? 'Not detected' : null,
  }

  await connectDB()
  const inspection = await Inspection.findOneAndUpdate(
    { inspectionId },
    {
      status: 'extracted',
      ocrRaw: msJson.result,
      fields,
    },
    { new: true }
  )

  return NextResponse.json({ inspection, structuredData: fields })
}
