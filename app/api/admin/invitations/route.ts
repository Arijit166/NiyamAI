import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import Invitation from '@/models/Invitation'
import { generateUniqueIdentificationCode } from '@/lib/generateCode'
import { sendInvitationEmail } from '@/lib/mailer'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }
  await connectDB()
  const invitations = await Invitation.find({}).sort({ createdAt: -1 }).lean()
  return NextResponse.json({ invitations })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  try {
    const { email, role } = await req.json()

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    if (!['executive_officer', 'senior_officer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 })
    }
    await connectDB()
    const normalizedEmail = String(email).trim().toLowerCase()

    const existingUser = await User.findOne({ email: normalizedEmail })
    if (existingUser) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }
    const existingInvite = await Invitation.findOne({ email: normalizedEmail, status: 'pending' })
    if (existingInvite) {
      return NextResponse.json({ error: 'This email already has a pending invitation.' }, { status: 409 })
    }

    const identificationCode = await generateUniqueIdentificationCode()

    const invitation = await Invitation.create({
      email: normalizedEmail,
      role,
      identificationCode,
      jurisdictionCity: null,
      jurisdictionState: null,
      status: 'pending',
      invitedBy: (session.user as any).id,
    })

    try {
      await sendInvitationEmail({
        to: normalizedEmail,
        role,
        identificationCode,
      })
    } catch (mailErr) {
      console.error('[invitations] email send failed:', mailErr)
      await Invitation.findByIdAndDelete(invitation._id)
      return NextResponse.json({ error: 'Could not send the invitation email. Please check the address and try again.' }, { status: 502 })
    }

    return NextResponse.json({ success: true, invitation }, { status: 201 })
  } catch (err) {
    console.error('[admin/invitations] create failed:', err)
    return NextResponse.json({ error: 'Failed to create invitation.' }, { status: 500 })
  }
}