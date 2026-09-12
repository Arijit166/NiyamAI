import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import Invitation from '@/models/Invitation' // NEW
import { resolveCityState } from '@/lib/geocode'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  // NEW — identificationCode/idProofType/idProofUrl replace jurisdictionCity here
  let { role, adminPasskey, identificationCode, jurisdictionCity: submittedJurisdictionCity, idProofType, idProofUrl } = await req.json()

  if (!['admin', 'executive_officer', 'senior_officer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 })
  }
  if (role === 'admin' && adminPasskey !== process.env.ADMIN_PASSKEY) {
    return NextResponse.json({ error: 'Invalid admin passkey.' }, { status: 403 })
  }

  await connectDB()
  const normalizedEmail = session.user.email.toLowerCase()
  const existingUser = await User.findOne({ email: normalizedEmail })

  if (existingUser?.role) {
    if (existingUser.role !== role) {
      return NextResponse.json({ error: `This account is assigned to ${existingUser.role === 'senior_officer' ? 'Senior Officer' : 'Executive Officer'}. Role changes must be approved by an admin.` }, { status: 403 })
    }
    return NextResponse.json({
      success: true,
      role: existingUser.role,
      jurisdictionCity: existingUser.jurisdictionCity,
      jurisdictionState: existingUser.jurisdictionState,
    })
  }

  let jurisdictionState: string | null = null
  let matchedInvitation: any = null

  // NEW — officers must match a pending admin-issued invitation, not type a free city
  if (role !== 'admin') {
    if (!String(identificationCode || '').trim()) {
      return NextResponse.json({ error: 'Please enter the identification code from your invitation email.' }, { status: 400 })
    }
    if (!idProofType || !idProofUrl) {
      return NextResponse.json({ error: 'Please upload a valid ID proof (Aadhar or PAN).' }, { status: 400 })
    }

    matchedInvitation = await Invitation.findOne({ email: normalizedEmail, status: { $in: ['pending', 'used'] } })
    if (!matchedInvitation) {
      return NextResponse.json({ error: 'No invitation found for this email. Please contact your admin.' }, { status: 404 })
    }
    if (matchedInvitation.identificationCode !== String(identificationCode).trim().toUpperCase()) {
      return NextResponse.json({ error: 'That identification code does not match our records.' }, { status: 403 })
    }
    if (matchedInvitation.role !== role) {
      return NextResponse.json({ error: `This invitation is assigned to ${matchedInvitation.role === 'senior_officer' ? 'Senior Officer' : 'Executive Officer'}. Please select the assigned role.` }, { status: 403 })
    }
    try {
      jurisdictionState = await resolveCityState(String(submittedJurisdictionCity || ''))
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Please enter a valid jurisdiction city.' }, { status: 400 })
    }

    role = matchedInvitation.role
  }

  const user = await User.findOneAndUpdate(
    { email: normalizedEmail },
    {
      role,
      jurisdictionCity: role === 'admin' ? null : String(submittedJurisdictionCity).trim(),
      jurisdictionState,
      identificationCode: matchedInvitation ? matchedInvitation.identificationCode : null, // NEW
      idProofType: role === 'admin' ? null : idProofType,   // NEW
      idProofUrl: role === 'admin' ? null : idProofUrl,     // NEW
      invitationId: matchedInvitation ? matchedInvitation._id.toString() : null, // NEW
    },
    { new: true }
  )
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  if (matchedInvitation) {
    matchedInvitation.status = 'used'
    matchedInvitation.usedAt = new Date()
    await matchedInvitation.save()
  }

  return NextResponse.json({
    success: true,
    role: user.role,
    jurisdictionCity: user.jurisdictionCity,
    jurisdictionState: user.jurisdictionState,
  })
}