import { NextRequest, NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import crypto from 'crypto'

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const idProofType = String(form.get('idProofType') || '')

    if (!file) return NextResponse.json({ error: 'Please attach your ID proof.' }, { status: 400 })
    if (!['aadhar', 'pan'].includes(idProofType)) {
      return NextResponse.json({ error: 'Please select a valid ID proof type.' }, { status: 400 })
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPG, PNG, WEBP or PDF files are allowed.' }, { status: 400 })
    }
    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: 'File must be under 5MB.' }, { status: 400 })
    }

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'id-proofs')
    await mkdir(uploadDir, { recursive: true })

    const ext = file.name.split('.').pop() || 'bin'
    const filename = `${crypto.randomUUID()}.${ext}`
    const bytes = Buffer.from(await file.arrayBuffer())
    await writeFile(path.join(uploadDir, filename), bytes)

    // Local disk is fine for dev — swap for S3/Cloudinary/GCS in production
    // and return that URL instead.
    return NextResponse.json({ success: true, url: `/uploads/id-proofs/${filename}`, idProofType })
  } catch (err) {
    console.error('[upload/id-proof] failed:', err)
    return NextResponse.json({ error: 'Failed to upload file.' }, { status: 500 })
  }
}