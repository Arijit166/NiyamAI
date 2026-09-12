import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import { generateApiKey } from '@/lib/apiKey'
import { sendManagerInvitationEmail } from '@/lib/mailer'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'compliance_head') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }
  await connectDB()
  const managers = await User.find(
    { role: 'product_manager', parentCompanyId: (session.user as any).id },
    { password: 0, apiKey: 0 }
  ).sort({ createdAt: -1 }).lean()
  return NextResponse.json({ managers })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'compliance_head') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const { managerName, managerEmail, productName } = await req.json()
  if (!managerName?.trim() || !managerEmail?.trim() || !productName?.trim()) {
    return NextResponse.json({ error: 'Manager name, email, and product name are required.' }, { status: 400 })
  }
  if (!emailRegex.test(managerEmail.trim())) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  await connectDB()
  const normalizedEmail = managerEmail.trim().toLowerCase()

  const existing = await User.findOne({ email: normalizedEmail })
  if (existing) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
  }

  const headUser = await User.findById((session.user as any).id).lean() as any
  if (!headUser) return NextResponse.json({ error: 'Company account not found.' }, { status: 404 })

  const apiKey = generateApiKey('NIYAM-PM')

  const manager = await User.create({
    name: managerName.trim(),
    email: normalizedEmail,
    role: 'product_manager',
    authProvider: 'credentials',
    companyName: headUser.companyName,
    productName: productName.trim(),
    parentCompanyId: headUser._id.toString(),
    apiKey,
  })

  await sendManagerInvitationEmail({
    to: normalizedEmail,
    managerName: managerName.trim(),
    companyName: headUser.companyName,
    productName: productName.trim(),
    apiKey,
  })

  return NextResponse.json({
    success: true,
    manager: { _id: manager._id, name: manager.name, email: manager.email, productName: manager.productName, createdAt: manager.createdAt },
  }, { status: 201 })
}