import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import { generateApiKey } from '@/lib/apiKey'
import { sendCompanyApprovedEmail } from '@/lib/mailer'
import mongoose from 'mongoose'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    const { id } = await params
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

    const apiKey = generateApiKey()
    company.companyStatus = 'approved'
    company.apiKey = apiKey
    company.rejectionReason = null
    await company.save()

    await sendCompanyApprovedEmail({
      to: company.email,
      companyName: company.companyName,
      apiKey,
    })

    return NextResponse.json({ success: true, companyStatus: 'approved' })
  } catch (err) {
    console.error('[admin/companies/:id/approve] failed:', err)
    return NextResponse.json({ error: 'Failed to approve company.' }, { status: 500 })
  }
}