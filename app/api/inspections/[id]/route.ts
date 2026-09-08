import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'
import mongoose from 'mongoose'

// GET /api/inspections/:id — :id is the Mongo _id (this is what the
// frontend actually has: InspectionHistoryView passes insp._id, and
// handleSaveCase stores saved.inspection._id as mongoInspectionId).
// The previous version of this route looked up by the human-readable
// `inspectionId` string instead, which is why detail/edit loads failed.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await connectDB()

    if (!mongoose.Types.ObjectId.isValid(params.id)) {
      return NextResponse.json({ error: 'Invalid inspection id.' }, { status: 400 })
    }

    // flattenMaps: the `fields` schema field is a Mongoose Map — without
    // this, .lean() can hand back a Map instance that doesn't serialize
    // cleanly through NextResponse.json(), which would silently blank out
    // every declaration field on the detail/edit screens.
    const inspection = await Inspection.findById(params.id).lean({ flattenMaps: true })
    if (!inspection) {
      return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
    }
    return NextResponse.json({ inspection })
  } catch (err) {
    console.error('[inspections/:id] fetch failed:', err)
    return NextResponse.json({ error: 'Failed to load inspection.' }, { status: 500 })
  }
}

// PATCH /api/inspections/:id — this is the piece that was missing.
// Called from two places in NiyamAIApp:
//
//   1. handleSaveCase, when re-saving an EDITED case (officer changed a
//      field like expiry_date/MRP, re-ran the rule engine, and clicked
//      "Save case" again). Sends the same shape as the original POST body:
//      { inspectionType, premisesName, notes, location, fields,
//        declaration, complianceResult, capturedImageUrl }.
//
//   2. handlePassToSenior, which sends only { passedToSeniorOfficer: true }.
//
// Only keys actually present in the body are written, so a "pass" call
// never clobbers the declaration/fields, and a "save after edit" call
// never has to also resend the pass flag.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
    }

    if (!mongoose.Types.ObjectId.isValid(params.id)) {
      return NextResponse.json({ error: 'Invalid inspection id.' }, { status: 400 })
    }

    const body = await req.json()
    const update: Record<string, unknown> = {}

    const allowedFields = [
      'inspectionType',
      'premisesName',
      'notes',
      'location',
      'fields',
      'declaration',
      'capturedImageUrl',
    ] as const

    for (const key of allowedFields) {
      if (body[key] !== undefined) update[key] = body[key]
    }

    // A fresh complianceResult means the officer edited a declared value
    // and re-ran the rule engine (the "edit -> re-check" flow). Re-derive
    // status from it, and reset the pass flag: a case that's just been
    // re-evaluated should go through "Pass to Senior Officer" again rather
    // than silently keeping whatever pass state existed before the edit.
    if (body.complianceResult !== undefined) {
      update.complianceResult = body.complianceResult
      const status = body.complianceResult?.status
      update.status =
        status === 'COMPLIANT' ? 'compliant' :
        status === 'NON-COMPLIANT' ? 'non_compliant' :
        status === 'REVIEW REQUIRED' ? 'review_required' :
        'reviewed'
      update.passedToSeniorOfficer = false
      update.passedAt = null
    }

    // Explicit pass-to-senior call (no complianceResult in the body).
    if (body.passedToSeniorOfficer !== undefined) {
      update.passedToSeniorOfficer = !!body.passedToSeniorOfficer
      update.passedAt = body.passedToSeniorOfficer ? new Date() : null
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update.' }, { status: 400 })
    }

    const inspection = await Inspection.findByIdAndUpdate(params.id, update, { new: true }).lean({
      flattenMaps: true,
    })
    if (!inspection) {
      return NextResponse.json({ error: 'Inspection not found.' }, { status: 404 })
    }

    return NextResponse.json({ inspection })
  } catch (err) {
    console.error('[inspections/:id] update failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update inspection.' },
      { status: 500 }
    )
  }
}