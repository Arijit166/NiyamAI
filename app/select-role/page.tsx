'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { ScanLine, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react'

const ROLES = [
  { value: 'senior_officer', label: 'Senior Officer' },
  { value: 'executive_officer', label: 'Executive Officer' },
  { value: 'admin', label: 'Admin' },
]

export default function SelectRolePage() {
  const { update } = useSession()
  const router = useRouter()
  const [role, setRole] = useState('')
  const [passkey, setPasskey] = useState('')
  const [jurisdictionCity, setJurisdictionCity] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError('')
    if (!role) return setError('Please select a role.')
    if (role === 'admin' && !passkey) return setError('Admin passkey is required.')
    if (role !== 'admin' && !jurisdictionCity.trim()) return setError('Please enter your jurisdiction city.')
    setLoading(true)

    const res = await fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, adminPasskey: passkey, jurisdictionCity: jurisdictionCity.trim() }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) return setError(data.error || 'Something went wrong.')

    await update({
      role: data.role,
      jurisdictionCity: data.jurisdictionCity,
      jurisdictionState: data.jurisdictionState,
    })
    router.push('/')
  }

  return (
    <main className="onboarding-page">
      <div className="onboarding-card">
        <div className="auth-brand"><ScanLine size={22} /> Niyam<span>AI</span></div>
        <div className="eyebrow">ONE LAST STEP</div>
        <h1>Select your role</h1>
        <p>Tell us your role to finish setting up your workspace.</p>

        <div className="role-select-list">
          {ROLES.map((r) => (
            <label key={r.value} className="check-label">
              <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)} />
              {r.label}
            </label>
          ))}
        </div>

        {role === 'admin' && (
          <label className="admin-passkey-group">Admin passkey
            <input type="password" placeholder="Enter admin passkey" value={passkey} onChange={(e) => setPasskey(e.target.value)} />
          </label>
        )}

        {role !== 'admin' && role && (
          <label className="admin-passkey-group">Jurisdiction city
            <input type="text" placeholder="Enter your city" value={jurisdictionCity} onChange={(e) => setJurisdictionCity(e.target.value)} />
          </label>
        )}

        {error && (
          <div className="auth-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        <button className="button primary select-role-submit" onClick={submit} disabled={loading}>
          <ShieldCheck size={16} /> {loading ? 'Saving...' : 'Continue'} <ArrowRight size={16} />
        </button>
      </div>
    </main>
  )
}