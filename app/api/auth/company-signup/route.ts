import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  try {
    const { name, companyName, email, password } = await req.json()

    if (!name || !companyName || !email || !password) {
      return NextResponse.json({ error: 'All fields are required.' }, { status: 400 })
    }
    if (!emailRegex.test(String(email).trim())) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters long.' }, { status: 400 })
    }
    if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return NextResponse.json({ error: 'Password must include uppercase, lowercase, number, and special character.' }, { status: 400 })
    }

    await connectDB()
    const normalizedEmail = String(email).trim().toLowerCase()

    const existing = await User.findOne({ email: normalizedEmail })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: 'compliance_head',
      authProvider: 'credentials',
      companyName: companyName.trim(),
      companyStatus: 'pending',
      apiKey: null,
      rejectionReason: null,
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (err) {
    console.error('Company signup error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}