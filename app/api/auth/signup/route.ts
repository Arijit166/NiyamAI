import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import Invitation from '@/models/Invitation'
import { resolveCityState } from '@/lib/geocode'

export async function POST(req: Request) {
  try {
    let { name, email, password, role, adminPasskey, identificationCode, jurisdictionCity: submittedJurisdictionCity, idProofType, idProofUrl } = await req.json()

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 })
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return NextResponse.json({ error: 'Password must include uppercase, lowercase, number, and special character.' }, { status: 400 })
    }
    if (!['admin', 'executive_officer', 'senior_officer'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 })
    }
    if (role === 'admin' && adminPasskey !== process.env.ADMIN_PASSKEY) {
      return NextResponse.json({ error: 'Invalid admin passkey.' }, { status: 403 })
    }

    await connectDB()
    const normalizedEmail = email.trim().toLowerCase()

    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      if (existing.authProvider === 'google') {
        return NextResponse.json({ error: 'This email is registered with Google. Please sign in with Google instead.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'An account with this email already exists. Please log in instead.' }, { status: 409 })
    }

    // NEW — officer signup must match a pending invitation
    let jurisdictionState: string | null = null
    let matchedInvitation: any = null

    if (role !== 'admin') {
      if (!String(identificationCode || '').trim()) {
        return NextResponse.json({ error: 'Please enter the identification code from your invitation email.' }, { status: 400 })
      }
      if (!idProofType || !idProofUrl) {
        return NextResponse.json({ error: 'Please upload a valid ID proof (Aadhar or PAN).' }, { status: 400 })
      }

      matchedInvitation = await Invitation.findOne({ email: normalizedEmail, status: 'pending' })
      if (!matchedInvitation) {
        return NextResponse.json({ error: 'No pending invitation found for this email. Please contact your admin.' }, { status: 404 })
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

    const hashedPassword = await bcrypt.hash(password, 10)
    await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role,
      authProvider: 'credentials',
      jurisdictionCity: role === 'admin' ? null : String(submittedJurisdictionCity).trim(),
      jurisdictionState,
      identificationCode: matchedInvitation ? matchedInvitation.identificationCode : null,
      idProofType: role === 'admin' ? null : idProofType,
      idProofUrl: role === 'admin' ? null : idProofUrl,
      invitationId: matchedInvitation ? matchedInvitation._id.toString() : null,
    })

    if (matchedInvitation) {
      matchedInvitation.status = 'used'
      matchedInvitation.usedAt = new Date()
      await matchedInvitation.save()
    }

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('Signup error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}