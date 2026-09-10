import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import Inspection from '@/models/Inspection'

const ACTIVE_WINDOW_MS = 5 * 60 * 1000 // treat as "online" if a heartbeat landed in the last 5 min

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }
    await connectDB()
    const users = await User.find(
      { role: { $in: ['executive_officer', 'senior_officer'] } },
      { password: 0 }
    ).sort({ createdAt: -1 }).lean()

    const withStats = await Promise.all(users.map(async (u: any) => {
      const isOnline = !!u.lastActiveAt && Date.now() - new Date(u.lastActiveAt).getTime() < ACTIVE_WINDOW_MS
      if (u.role === 'executive_officer') {
        const totalInspections = await Inspection.countDocuments({ officer: u._id })
        return { ...u, isOnline, stats: { totalInspections } }
      }
      // Note: "pending" is the shared review queue (no per-officer assignment
      // exists in the schema), so it's the same count for every senior
      // officer. Accepted/rejected are specific to this officer via reviewedBy.
      const [pending, accepted, rejected] = await Promise.all([
        Inspection.countDocuments({ passedToSeniorOfficer: true, reviewStatus: 'pending' }),
        Inspection.countDocuments({ reviewedBy: u._id, reviewStatus: 'accepted' }),
        Inspection.countDocuments({ reviewedBy: u._id, reviewStatus: 'rejected' }),
      ])
      return { ...u, isOnline, stats: { pending, accepted, rejected } }
    }))

    return NextResponse.json({ users: withStats })
  } catch (err) {
    console.error('[admin/users] list failed:', err)
    return NextResponse.json({ error: 'Failed to load users.' }, { status: 500 })
  }
}