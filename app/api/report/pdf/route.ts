import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import React from 'react'
import { InspectionReportDocument } from '@/lib/pdf/InspectionReportDocument'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'
import type { ProductDeclaration, ComplianceResult } from '@/lib/rules/types'

interface PdfRequestBody {
  inspectionId?: string
  premisesName?: string
  location?: string
  officerName?: string
  inspectionType?: string
  declaration: ProductDeclaration
  result: ComplianceResult
}

// POST /api/report/pdf — used from ResultView / ReportView, straight off
// whatever's currently in React state (no DB round-trip needed; the case
// doesn't even have to be saved yet).
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as PdfRequestBody
    if (!body.declaration || !body.result) {
      return NextResponse.json({ error: 'declaration and result are required.' }, { status: 400 })
    }

    const buffer = await renderToBuffer(
      React.createElement(InspectionReportDocument, {
        inspectionId: body.inspectionId,
        premisesName: body.premisesName,
        location: body.location,
        officerName: body.officerName,
        inspectionType: body.inspectionType,
        generatedAt: new Date().toLocaleString('en-IN'),
        declaration: body.declaration,
        result: body.result,
      }) as React.ReactElement<any>
    )

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inspection-${body.inspectionId || 'report'}.pdf"`,
      },
    })
  } catch (err) {
    console.error('[report/pdf] generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate PDF report.' }, { status: 500 })
  }
}

// GET /api/report/pdf?id=INS-2026-00126 — regenerate a report for an
// already-saved inspection straight from the DB. Used from the Inspections
// history list, once you build that screen out.
export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id query param is required.' }, { status: 400 })

    await connectDB()
    const inspection = await Inspection.findOne({ inspectionId: id }).lean<any>()
    if (!inspection) return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })

    const declaration = inspection.declaration as ProductDeclaration
    const result = inspection.complianceResult as ComplianceResult
    if (!declaration || !result) {
      return NextResponse.json(
        { error: 'This inspection has no saved compliance result to export.' },
        { status: 400 }
      )
    }

    const buffer = await renderToBuffer(
      React.createElement(InspectionReportDocument, {
        inspectionId: inspection.inspectionId,
        premisesName: inspection.premisesName,
        location: inspection.location?.address,
        inspectionType: inspection.inspectionType,
        generatedAt: new Date().toLocaleString('en-IN'),
        declaration,
        result,
      }) as React.ReactElement<any>
    )

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="inspection-${id}.pdf"`,
      },
    })
  } catch (err) {
    console.error('[report/pdf] generation failed:', err)
    return NextResponse.json({ error: 'Failed to generate PDF report.' }, { status: 500 })
  }
}
