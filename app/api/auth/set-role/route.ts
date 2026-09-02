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

  const { role, adminPasskey } = await req.json()

  if (!['admin', 'executive_officer', 'senior_officer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 })
  }
  if (role === 'admin' && adminPasskey !== process.env.ADMIN_PASSKEY) {
    return NextResponse.json({ error: 'Invalid admin passkey.' }, { status: 403 })
  }

  await connectDB()
  const user = await User.findOneAndUpdate({ email: session.user.email.toLowerCase() }, { role }, { new: true })
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  return NextResponse.json({ success: true, role: user.role })
}