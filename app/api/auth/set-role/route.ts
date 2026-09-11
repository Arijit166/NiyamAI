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

  const { role, adminPasskey, jurisdictionCity } = await req.json()

  if (!['admin', 'executive_officer', 'senior_officer'].includes(role)) {
    return NextResponse.json({ error: 'Invalid role selected.' }, { status: 400 })
  }
  if (role === 'admin' && adminPasskey !== process.env.ADMIN_PASSKEY) {
    return NextResponse.json({ error: 'Invalid admin passkey.' }, { status: 403 })
  }
  if (role !== 'admin' && !String(jurisdictionCity || '').trim()) {
    return NextResponse.json({ error: 'Please enter your jurisdiction city.' }, { status: 400 })
  }

  // NEW — same geocode-city-to-state resolution as signup
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

  await connectDB()
  const user = await User.findOneAndUpdate({ email: session.user.email.toLowerCase() }, { role, jurisdictionCity: role === 'admin' ? null : String(jurisdictionCity).trim(), jurisdictionState,  }, { new: true })
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  return NextResponse.json({
    success: true,
    role: user.role,
    jurisdictionCity: user.jurisdictionCity,
    jurisdictionState: user.jurisdictionState,
  })
}