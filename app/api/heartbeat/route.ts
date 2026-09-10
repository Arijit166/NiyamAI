import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

export async function POST() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) return NextResponse.json({ ok: false }, { status: 401 })
    await connectDB()
    await User.updateOne({ email: session.user.email }, { $set: { lastActiveAt: new Date() } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[heartbeat] failed:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}