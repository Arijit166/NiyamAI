import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  const { identificationCode } = await req.json()
  if (!String(identificationCode || '').trim()) {
    return NextResponse.json({ error: 'Please enter your identification code.' }, { status: 400 })
  }

  await connectDB()
  const user = await User.findOne({ email: session.user.email.toLowerCase() })
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  if (!user.identificationCode) {
    return NextResponse.json({ success: true }) // e.g. admin — no code required
  }

  if (user.identificationCode !== String(identificationCode).trim().toUpperCase()) {
    return NextResponse.json({ error: 'That identification code does not match our records.' }, { status: 403 })
  }

  return NextResponse.json({ success: true })
}