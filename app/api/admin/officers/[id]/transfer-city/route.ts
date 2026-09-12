import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'
import { resolveCityState } from '@/lib/geocode'
import mongoose from 'mongoose'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions)
  if (!session?.user || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const { id } = await params
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: 'Invalid user id.' }, { status: 400 })
  }

  const { jurisdictionCity } = await req.json()
  if (!String(jurisdictionCity || '').trim()) {
    return NextResponse.json({ error: 'Please enter a jurisdiction city.' }, { status: 400 })
  }

  let jurisdictionState: string
  try {
    jurisdictionState = await resolveCityState(jurisdictionCity)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid city.' }, { status: 400 })
  }

  await connectDB()
  const officer = await User.findOneAndUpdate(
    { _id: id, role: { $in: ['executive_officer', 'senior_officer'] } },
    { jurisdictionCity: String(jurisdictionCity).trim(), jurisdictionState },
    { new: true }
  ).lean() as any

  if (!officer) return NextResponse.json({ error: 'Officer not found.' }, { status: 404 })

  return NextResponse.json({ success: true, jurisdictionCity: officer.jurisdictionCity, jurisdictionState: officer.jurisdictionState })
}