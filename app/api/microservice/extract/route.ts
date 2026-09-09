import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'

export const runtime = 'nodejs' // needed for multipart/form-data handling

const MICROSERVICE_URL = process.env.MICROSERVICE_URL || 'http://localhost:8000'
const FONT_HEIGHT_CORRECTION = 1.35

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
const FONT_CONFIDENCE_MAP: Record<string, number> = { HIGH: 0.9, MEDIUM: 0.65, LOW: 0.4 }
// POST /api/microservice/extract
// FormData: { inspectionId: string, image: File }
// Single-capture flow: exactly one package photo, no multi-surface set.
export async function POST(req: Request) {
  const form = await req.formData()
  const inspectionId = form.get('inspectionId') as string | null
  const image = form.get('image') as File | null
  const markerSizeMm = form.get('markerSizeMm') as string | null

  if (!inspectionId || !image) {
    return NextResponse.json({ error: 'inspectionId and image are required' }, { status: 400 })
  }

  const forwardForm = new FormData()
  forwardForm.append('file', image, image.name || 'capture.jpg')
  forwardForm.append(
    'marker_size_mm',
    markerSizeMm && !isNaN(Number(markerSizeMm)) ? markerSizeMm : '20',
  )

  const msRes = await fetch(`${MICROSERVICE_URL}/extract`, { method: 'POST', body: forwardForm })
  const rawText = await msRes.text()
  if (!msRes.ok) {
    let errorMsg = `Microservice error (${msRes.status}): ${rawText}`
    try {
      const parsed = JSON.parse(rawText)
      if (parsed.error) errorMsg = parsed.error
      else if (parsed.detail) errorMsg = typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail)
    } catch {}
    return NextResponse.json({ error: errorMsg }, { status: msRes.status || 502 })
  }
  let msJson: any = null
  try {
    msJson = JSON.parse(rawText)
  } catch {
    return NextResponse.json({ error: `Microservice returned invalid JSON: ${rawText.slice(0, 300)}` }, { status: 502 })
  }
  if (!msJson || !msJson.result) {
    return NextResponse.json({ error: msJson?.error || 'Microservice returned an empty or invalid result.' }, { status: 422 })
  }
  const structuredData = msJson?.result?.structured_data || {}
  const fields: Record<string, any> = {}
  for (const [name, entry] of Object.entries<any>(structuredData)) {
    // Skip normalizer.py's audit-trail copies (mrp_raw, manufacturing_date_normalized,
    // etc.) — these exist for the audit log, not as separate declarations to show
    // or resolve. Without this filter, MRP (and anything else normalized) showed
    // up twice on the Extraction screen.
    if (name.endsWith('_raw') || name.endsWith('_normalized')) continue
    const missing = isMissingValue(entry.value)
    fields[name] = {
      value: missing ? null : String(entry.value),
      confidence: entry.confidence ?? 0,
      source: null,
      status: missing ? 'missing' : 'extracted',
      reason: missing ? entry.reason || 'Not detected' : entry.validation_reason || null,
    }
  }

  const productName = msJson?.result?.product_name
  fields['product_name'] = {
    value: isMissingValue(productName) ? null : String(productName),
    confidence: 0,
    source: null,
    status: isMissingValue(productName) ? 'missing' : 'extracted',
    reason: isMissingValue(productName) ? 'Not detected' : null,
  }

  // NEW: auto-fill font_height_mm from font.py's ArUco-calibrated measurement
  // (json_builder's "font_measurements" block) rather than leaving it for the
  // officer to type in — Rule 7's numeral-height check governs the net
  // quantity declaration specifically, so that field is preferred when its
  // measurement is available; otherwise the highest-confidence measurement
  // found anywhere on the label is used.
  const fontMeasurements = msJson?.result?.font_measurements
  const markerDetected = !!fontMeasurements?.measurement_available
  if (markerDetected) {
    for (const [fieldName, measurement] of Object.entries<any>(fontMeasurements.fields || {})) {
      if (!measurement?.available || !fields[fieldName]) continue
      const correctedHeight = Number(measurement.character_height_mm) * FONT_HEIGHT_CORRECTION
      fields[fieldName].fontHeightPerMmUnit = correctedHeight
      fields[fieldName].fontHeightConfidence = measurement.confidence
      fields[fieldName].fontHeightUncertaintyPerMmUnit = measurement.measurement_uncertainty_mm
    }
    const CONFIDENCE_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }
    let best: { field: string; measurement: any } | null = null
    for (const [fieldName, measurement] of Object.entries<any>(fontMeasurements.fields || {})) {
      if (!measurement?.available) continue
      if (fieldName === 'net_quantity') { best = { field: fieldName, measurement }; break }
      if (!best || (CONFIDENCE_RANK[measurement.confidence] || 0) > (CONFIDENCE_RANK[best.measurement.confidence] || 0)) {
        best = { field: fieldName, measurement }
      }
    }
    if (best) {
      const correctedHeight = Number(best.measurement.character_height_mm) * FONT_HEIGHT_CORRECTION
      fields['font_height_mm'] = {
        value: String(Math.round(correctedHeight * 100) / 100),
        confidence: FONT_CONFIDENCE_MAP[best.measurement.confidence] ?? 0.8,
        source: 'font_measurement',
        status: 'extracted',
        reason: `Measured from "${best.field}" via ArUco calibration marker (±${best.measurement.measurement_uncertainty_mm}mm).`,
        // fontHeightPerMmUnit lets confirmMarkerSize multiply by the real block size
        // and write the calibrated value back to .value for the rule engine.
        fontHeightPerMmUnit: correctedHeight,
      }
    }
  }

  if (!fields['font_height_mm'] || fields['font_height_mm'].status === 'missing' || !fields['font_height_mm'].value) {
    fields['font_height_mm'] = {
      value: null,
      confidence: 0,
      source: null,
      status: 'missing',
      reason: 'ArUco cannot be detected — enter font size manually',
    }
  }

  await connectDB()
  const inspection = await Inspection.findOneAndUpdate(
    { inspectionId },
    { status: 'extracted', ocrRaw: msJson.result, fields },
    { new: true }
  )

  // NEW: readability travels alongside the extraction response but is
  // deliberately NOT merged into `fields` — it's not a declaration the
  // officer resolves, just evidence quality shown later on the report.
  return NextResponse.json({
    inspection,
    structuredData: fields,
    readability: msJson?.result?.readability || null,
    markerDetected,   // NEW — tells the frontend whether to prompt for the reference block's real size
  })
}