'use client'

import { useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react'

export function VerifyCodeForm() {
  const { update } = useSession()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError('')
    if (!code.trim()) return setError('Please enter your identification code.')

    setLoading(true)
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identificationCode: code.trim() }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) return setError(data.error || 'Verification failed.')

    await update({ codeVerified: true })
    window.location.assign('/dashboard')
  }

  return (
    <main className="auth-page">
      <section className="auth-panel" style={{ margin: '0 auto' }}>
        <div className="auth-card">
          <div className="eyebrow">IDENTITY VERIFICATION</div>
          <h2>Enter your identification code</h2>
          <p>For your security, enter the identification code you received by email to continue.</p>

          <label>Identification code
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="NIYAM-XXXX-XXXX" autoFocus />
          </label>

          {error && (
            <div className="auth-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          <button className="button primary auth-submit" onClick={handleSubmit} disabled={loading}>
            <ShieldCheck size={16} />
            {loading ? 'Verifying...' : 'Verify & continue'}
            <ArrowRight size={16} />
          </button>

          <p className="auth-switch" style={{ marginTop: 24 }}>
            Wrong account? <a onClick={() => signOut({ callbackUrl: '/login' })} style={{ cursor: 'pointer' }}>Sign out</a>
          </p>
        </div>
      </section>
    </main>
  )
}