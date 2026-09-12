import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import { sendCompanyRejectedEmail } from '@/lib/mailer'
import mongoose from 'mongoose'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const { id } = await params
    const { reason } = await req.json()
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ error: 'Invalid company id.' }, { status: 400 })
    }

    await connectDB()
    const company = await User.findById(id)
    if (!company || company.role !== 'compliance_head') {
      return NextResponse.json({ error: 'Company not found.' }, { status: 404 })
    }
    if (company.companyStatus !== 'pending') {
      return NextResponse.json({ error: 'This request has already been reviewed.' }, { status: 409 })
    }

    company.companyStatus = 'rejected'
    company.apiKey = null
    company.rejectionReason = reason?.trim() || null
    await company.save()

    await sendCompanyRejectedEmail({
      to: company.email,
      companyName: company.companyName,
      reason: company.rejectionReason,
    })

    return NextResponse.json({ success: true, companyStatus: 'rejected' })
  } catch (err) {
    console.error('[admin/companies/:id/reject] failed:', err)
    return NextResponse.json({ error: 'Failed to reject company.' }, { status: 500 })
  }
}