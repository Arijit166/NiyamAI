import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    await connectDB()
    const companies = await User.find(
      { role: 'compliance_head' },
      { password: 0, apiKey: 0 }
    ).sort({ createdAt: -1 }).lean()

    return NextResponse.json({ companies })
  } catch (err) {
    console.error('[admin/companies] list failed:', err)
    return NextResponse.json({ error: 'Failed to load companies.' }, { status: 500 })
  }
}