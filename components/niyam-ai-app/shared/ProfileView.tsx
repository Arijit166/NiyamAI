'use client'

import { useRef, useState } from 'react'
import { UserRound } from 'lucide-react'

function Avatar({ name, image, size = 72 }: { name?: string | null; image?: string | null; size?: number }) {
  if (image) return <div className="avatar" style={{ width: size, height: size }}><img src={image} alt={name || 'User'} referrerPolicy="no-referrer" /></div>
  return <div className="avatar avatar-blank" style={{ width: size, height: size }}><UserRound size={Math.round(size * 0.5)} /></div>
}

export function SimpleProfileView({
  user, roleLabel, extraFields, onPhotoChange,
}: {
  user: { name?: string | null; image?: string | null }
  roleLabel: string
  extraFields?: { label: string; value: string }[]
  onPhotoChange: (image: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'uploading' | 'removing' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fileToBase64 = (f: File, maxDim = 320, quality = 0.8): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(f)
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        URL.revokeObjectURL(url)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = reject
      img.src = url
    })

  const handleUpload = async (f: File | null) => {
    if (!f) return
    setBusy('uploading')
    setError(null)
    try {
      const base64 = await fileToBase64(f)
      const res = await fetch('/api/profile/photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 }),
      })
      if (!res.ok) throw new Error('Failed to upload photo.')
      onPhotoChange(base64)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload photo.')
    } finally {
      setBusy(null)
    }
  }

  const handleRemove = async () => {
    setBusy('removing')
    setError(null)
    try {
      const res = await fetch('/api/profile/photo', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove photo.')
      onPhotoChange(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove photo.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="page-content narrow">
      <div className="page-heading"><div><div className="eyebrow">ACCOUNT</div><h1>Profile</h1></div></div>
      <section className="panel" style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <Avatar name={user.name} image={user.image} />
        <div>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpload(e.target.files?.[0] || null)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="button secondary" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
              {busy === 'uploading' ? 'Uploading...' : user.image ? 'Change photo' : 'Upload photo'}
            </button>
            {user.image && <button className="button secondary" onClick={handleRemove} disabled={busy !== null}>{busy === 'removing' ? 'Removing...' : 'Remove photo'}</button>}
          </div>
          {error && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{error}</p>}
        </div>
      </section>
      <section className="panel" style={{ padding: 20 }}>
        <div className="declaration-field"><label>Name</label><div><input value={user.name || ''} readOnly /></div></div>
        <div className="declaration-field"><label>Role</label><div><input value={roleLabel} readOnly /></div></div>
        {extraFields?.map((f) => (
          <div className="declaration-field" key={f.label}><label>{f.label}</label><div><input value={f.value} readOnly /></div></div>
        ))}
      </section>
    </div>
  )
}