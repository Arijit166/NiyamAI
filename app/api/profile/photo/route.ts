import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/app/api/auth/[...nextauth]/route'
import { connectDB } from '@/lib/mongodb'
import User from '@/models/User'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }

  await connectDB()
  const user = await User.findOne({ email: session.user.email.toLowerCase() }).select('image').lean()
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  return NextResponse.json({ image: user.image || null })
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  const { image } = await req.json()
  if (!image) return NextResponse.json({ error: 'No image provided.' }, { status: 400 })

  await connectDB()
  const user = await User.findOneAndUpdate(
    { email: session.user.email.toLowerCase() },
    { image },
    { new: true }
  )
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  return NextResponse.json({ success: true, image: user.image })
}

export async function DELETE() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Not authenticated.' }, { status: 401 })
  }
  await connectDB()
  const user = await User.findOneAndUpdate(
    { email: session.user.email.toLowerCase() },
    { image: null },
    { new: true }
  )
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })
  return NextResponse.json({ success: true })
}