import { NextRequest, NextResponse } from 'next/server'
import type { ProductDeclaration } from '@/lib/rules/types'
import { evaluateCompliance } from '@/lib/compliance/evaluateCompliance'

// POST /api/compliance/evaluate
// Body: a ProductDeclaration — the mock JSON shape the capture/OCR layer
// will eventually emit (see lib/rules/types.ts). Returns a ComplianceResult.
export async function POST(req: NextRequest) {
  let input: ProductDeclaration
  try {
    input = await req.json()
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!input || typeof input !== 'object') {
    return NextResponse.json({ error: 'Request body must be a ProductDeclaration object.' }, { status: 400 })
  }

  try {
    const result = await evaluateCompliance(input)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[compliance/evaluate] failed:', err)
    return NextResponse.json({ error: 'Compliance evaluation failed.' }, { status: 500 })
  }
}