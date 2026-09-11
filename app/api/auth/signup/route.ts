import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

export async function POST(req: Request) {
  try {
    const { name, email, password, role, adminPasskey, jurisdictionCity} = await req.json()

    if (!name || !email || !password || !role) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    if (role !== 'admin' && !String(jurisdictionCity || '').trim()) {
      return NextResponse.json({ error: 'Please enter your jurisdiction city.' }, { status: 400 })
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

    const existing = await User.findOne({ email: email.toLowerCase() })
    if (existing) {
      if (existing.authProvider === 'google') {
        return NextResponse.json(
          { error: 'This email is registered with Google. Please sign in with Google instead.' },
          { status: 409 }
        )
      }
      return NextResponse.json(
        { error: 'An account with this email already exists. Please log in instead.' },
        { status: 409 }
      )
    }

    let jurisdictionState: string | null = null
    if (role !== 'admin') {
      try {
        const geoRes = await fetch(
          `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=in&q=${encodeURIComponent(jurisdictionCity)}`,
          { headers: { Accept: 'application/json', 'User-Agent': 'NiyamAI/1.0' } }
        )
        const results = await geoRes.json()
        jurisdictionState = results?.[0]?.address?.state || null
      } catch {
        jurisdictionState = null
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await User.create({ name, email: email.toLowerCase(), password: hashedPassword, role, authProvider: 'credentials',       jurisdictionCity: role === 'admin' ? null : String(jurisdictionCity).trim(), jurisdictionState, })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('Signup error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}