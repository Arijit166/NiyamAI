import { NextRequest, NextResponse } from 'next/server'
import { evaluateCompliance } from '@/lib/compliance/engine'
import type { ProductDeclaration } from '@/lib/rules/types'

// Called from AnalysisView's "View compliance result" button. Pure function
// of the declaration — resolves the correct dated rule version internally
// (see lib/rules/ruleVersions.ts) and returns a full ComplianceResult.
export async function POST(req: NextRequest) {
  try {
    const declaration = (await req.json()) as ProductDeclaration
    if (!declaration || typeof declaration !== 'object') {
      return NextResponse.json({ error: 'Request body must be a ProductDeclaration object.' }, { status: 400 })
    }

    const result = await evaluateCompliance(declaration)
    return NextResponse.json(result)
  } catch (err) {
    console.error('[compliance/evaluate] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Compliance evaluation failed.' },
      { status: 500 }
    )
  }
}
