'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { ScanLine, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react'

const ROLES = [
  { value: 'senior_officer', label: 'Senior Officer' },
  { value: 'executive_officer', label: 'Executive Officer' },
  { value: 'admin', label: 'Admin' },
]

export default function SelectRolePage() {
  const { update } = useSession()
  const [role, setRole] = useState('')
  const [passkey, setPasskey] = useState('')
  const [identificationCode, setIdentificationCode] = useState('')   // NEW — replaces free-typed jurisdictionCity
  const [jurisdictionCity, setJurisdictionCity] = useState('')
  const [idProofType, setIdProofType] = useState<'aadhar' | 'pan' | ''>('') // NEW
  const [idProofFile, setIdProofFile] = useState<File | null>(null)  // NEW
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleRoleChange = (nextRole: string) => {
    setRole(nextRole)
    setIdProofType('')
    setIdProofFile(null)
    setError('')
  }

  const submit = async () => {
    setError('')
    if (!role) return setError('Please select a role.')
    if (role === 'admin' && !passkey) return setError('Admin passkey is required.')

    // NEW — officers verify via their invitation code + ID proof instead of typing a city
    if (role !== 'admin') {
      if (!identificationCode.trim()) return setError('Please enter the identification code from your invitation email.')
      if (!jurisdictionCity.trim()) return setError('Please enter your jurisdiction city.')
      if (!idProofType) return setError('Please select an ID proof type.')
      if (!idProofFile) return setError('Please upload your ID proof (Aadhar or PAN).')
    }

    setLoading(true)

    // NEW — upload the ID proof first, then submit role selection with the returned URL
    let idProofUrl = ''
    if (role !== 'admin' && idProofFile) {
      const fd = new FormData()
      fd.append('file', idProofFile)
      fd.append('idProofType', idProofType)
      const uploadRes = await fetch('/api/upload/id-proof', { method: 'POST', body: fd })
      const uploadData = await uploadRes.json()
      if (!uploadRes.ok) {
        setLoading(false)
        return setError(uploadData.error || 'Failed to upload ID proof.')
      }
      idProofUrl = uploadData.url
    }

    const res = await fetch('/api/auth/set-role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role,
        adminPasskey: passkey,
        identificationCode: identificationCode.trim(),
        jurisdictionCity: jurisdictionCity.trim(),
        idProofType: role === 'admin' ? null : idProofType,
        idProofUrl: role === 'admin' ? null : idProofUrl,
      }),
    })
    const data = await res.json()
    setLoading(false)

    if (!res.ok) return setError(data.error || 'Something went wrong.')

    const updatedSession = await update({
      role: data.role,
      jurisdictionCity: data.jurisdictionCity,
      jurisdictionState: data.jurisdictionState,
      codeVerified: true,
    })
    if (updatedSession?.user?.role !== data.role) {
      setLoading(false)
      return setError('Your role could not be saved. Please try again.')
    }
    window.location.assign('/')
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
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => handleRoleChange(r.value)}
              />
              {r.label}
            </label>
          ))}
        </div>

        {role === 'admin' && (
          <label className="admin-passkey-group">Admin passkey
            <input type="password" placeholder="Enter admin passkey" value={passkey} onChange={(e) => setPasskey(e.target.value)} />
          </label>
        )}

        {/* NEW — replaces the old free-typed jurisdiction city input for officers */}
        {role !== 'admin' && role && (
          <>
            <label className="admin-passkey-group">Identification code
              <input
                type="text"
                placeholder="Sent to you by your admin, e.g. NIYAM-XXXX-XXXX"
                value={identificationCode}
                onChange={(e) => setIdentificationCode(e.target.value)}
              />
            </label>

            <label className="admin-passkey-group">Jurisdiction city
              <input
                type="text"
                placeholder="Enter your assigned city, e.g. Kolkata"
                value={jurisdictionCity}
                onChange={(e) => setJurisdictionCity(e.target.value)}
              />
            </label>

            <label className="admin-passkey-group">ID proof type
              <select
                value={idProofType}
                onChange={(e) => {
                  setIdProofType(e.currentTarget.value as 'aadhar' | 'pan' | '')
                  setIdProofFile(null)
                }}
              >
                <option value="">Select ID type</option>
                <option value="aadhar">Aadhar Card</option>
                <option value="pan">PAN Card</option>
              </select>
            </label>

            {idProofType && (
              <label className="admin-passkey-group">Upload {idProofType === 'aadhar' ? 'Aadhar' : 'PAN'} proof
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => setIdProofFile(e.currentTarget.files?.[0] || null)}
                />
              </label>
            )}
          </>
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