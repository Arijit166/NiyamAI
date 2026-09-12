import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import Inspection from '@/models/Inspection'
import User from '@/models/User'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user || (session.user as any).role !== 'compliance_head') {
      return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
    }

    await connectDB()
    const companyId = (session.user as any).id
    const managers = await User.find({ role: 'product_manager', parentCompanyId: companyId }, { password: 0, apiKey: 0 }).sort({ createdAt: -1 }).lean()
    const managerIds = managers.map((manager) => manager._id)
    const managerQuery = { officer: { $in: managerIds } }

    const [total, compliant, nonCompliant, reviewRequired, recent, grouped] = await Promise.all([
      Inspection.countDocuments(managerQuery),
      Inspection.countDocuments({ ...managerQuery, status: 'compliant' }),
      Inspection.countDocuments({ ...managerQuery, status: 'non_compliant' }),
      Inspection.countDocuments({ ...managerQuery, status: 'review_required' }),
      Inspection.find(managerQuery).populate('officer', 'name productName').sort({ createdAt: -1 }).limit(6).lean({ flattenMaps: true }),
      Inspection.aggregate([
        { $match: managerQuery },
        { $group: { _id: '$officer', total: { $sum: 1 }, compliant: { $sum: { $cond: [{ $eq: ['$status', 'compliant'] }, 1, 0] } }, nonCompliant: { $sum: { $cond: [{ $eq: ['$status', 'non_compliant'] }, 1, 0] } }, reviewRequired: { $sum: { $cond: [{ $eq: ['$status', 'review_required'] }, 1, 0] } } } },
      ]),
    ])

    const statsByManager = new Map(grouped.map((item) => [String(item._id), item]))
    const managerStats = managers.map((manager) => ({
      _id: manager._id,
      name: manager.name,
      productName: manager.productName,
      ...((statsByManager.get(String(manager._id)) as any) || { total: 0, compliant: 0, nonCompliant: 0, reviewRequired: 0 }),
    }))

    return NextResponse.json({ total, compliant, nonCompliant, reviewRequired, recent, managers: managerStats })
  } catch (error) {
    console.error('[compliance/dashboard] failed:', error)
    return NextResponse.json({ error: 'Failed to load dashboard.' }, { status: 500 })
  }
}