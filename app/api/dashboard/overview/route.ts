import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'
import User from '@/models/User'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  await connectDB()
  const role = (session.user as any).role
  const userId = (session.user as any).id

  if (role === 'executive_officer') {
    const [total, compliant, nonCompliant, recent] = await Promise.all([
      Inspection.countDocuments({ officer: userId }),
      Inspection.countDocuments({ officer: userId, status: 'compliant' }),
      Inspection.countDocuments({ officer: userId, status: 'non_compliant' }),
      Inspection.find({ officer: userId }).sort({ createdAt: -1 }).limit(3).lean({ flattenMaps: true }),
    ])
    return NextResponse.json({ role, total, compliant, nonCompliant, recent })
  }

  if (role === 'senior_officer') {
    const [accepted, rejected, recent] = await Promise.all([
      Inspection.countDocuments({ reviewedBy: userId, reviewStatus: 'accepted' }),
      Inspection.countDocuments({ reviewedBy: userId, reviewStatus: 'rejected' }),
      Inspection.find({ reviewedBy: userId, reviewStatus: { $in: ['accepted', 'rejected'] } })
        .sort({ reviewedAt: -1 })
        .limit(3)
        .lean({ flattenMaps: true }),
    ])
    return NextResponse.json({ role, reviewsDone: accepted + rejected, accepted, rejected, recent })
  }

  if (role === 'admin') {
    const [executiveOfficers, seniorOfficers, repeatedAgg] = await Promise.all([
      User.countDocuments({ role: 'executive_officer' }),
      User.countDocuments({ role: 'senior_officer' }),
      // "Repeated violation" = same premises with more than one non-compliant case.
      // Adjust the $group key (e.g. to declaration.company_name) if you'd rather
      // group by manufacturer instead of premises.
      Inspection.aggregate([
        { $match: { status: 'non_compliant' } },
        { $group: { _id: '$premisesName', count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $count: 'total' },
      ]),
    ])
    const repeatedViolations = repeatedAgg[0]?.total || 0
    return NextResponse.json({ role, executiveOfficers, seniorOfficers, repeatedViolations })
  }

  return NextResponse.json({ error: 'Unknown role.' }, { status: 400 })
}