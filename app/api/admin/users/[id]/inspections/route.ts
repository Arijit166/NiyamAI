import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import Inspection from '@/models/Inspection'
import mongoose from 'mongoose'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const { id } = await params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
    }
    await connectDB()
    const officer = await User.findById(id).lean() as any
    if (!officer) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

    const projection = {
      inspectionId: 1, premisesName: 1, location: 1, status: 1,
      'declaration.product_name': 1, complianceResult: 1,
      passedToSeniorOfficer: 1, reviewStatus: 1, rejectionReason: 1,
      reviewedAt: 1, createdAt: 1,
    }

    if (officer.role === 'executive_officer') {
      const inspections = await Inspection.find({ officer: id }, projection).sort({ createdAt: -1 }).lean()
      return NextResponse.json({ inspections })
    }

    if (officer.role === 'senior_officer') {
      const status = req.nextUrl.searchParams.get('status') || 'pending'
      const query = status === 'pending'
        ? { passedToSeniorOfficer: true, reviewStatus: 'pending' }
        : { reviewedBy: id, reviewStatus: status }
      const inspections = await Inspection.find(query, projection).sort({ createdAt: -1 }).lean()
      return NextResponse.json({ inspections })
    }

    return NextResponse.json({ inspections: [] })
  } catch (err) {
    console.error('[admin/users/:id/inspections] failed:', err)
    return NextResponse.json({ error: 'Failed to load inspections.' }, { status: 500 })
  }
}