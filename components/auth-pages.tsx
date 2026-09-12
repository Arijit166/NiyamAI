'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { ScanLine, ShieldCheck, ArrowRight, LockKeyhole, UserPlus, AlertCircle } from 'lucide-react'
import { ThemeToggle } from '@/components/theme-toggle'

const ROLES = [
  { value: 'senior_officer', label: 'Senior Officer' },
  { value: 'executive_officer', label: 'Executive Officer' },
  { value: 'compliance_head', label: 'Compliance Head (Company)' }, // NEW
  { value: 'admin', label: 'Admin' },
]

const ERROR_MESSAGES: Record<string, string> = {
  CredentialsSignin: 'Invalid email or password.',
  UseCredentials: 'This email is registered with a password. Please sign in with email and password.',
  NoAccount: 'No account found with this email. Please sign up first.',
  AccountExists: 'An account with this email already exists. Please log in instead.',
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

const getPasswordError = (password: string) => {
  if (password.length < 8) return 'Password must be at least 8 characters long.'
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter (A-Z).'
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter (a-z).'
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number (0-9).'
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return 'Password must contain at least one special character (e.g. @, #, $, !).'
  return null
}

function AuthShell({ signup = false }: { signup?: boolean }) {
  const router = useRouter()
  const params = useSearchParams()
  const urlError = params.get('error')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [role, setRole] = useState('')
  const [passkey, setPasskey] = useState('')
  const [jurisdictionCity, setJurisdictionCity] = useState('')
  const [error, setError] = useState(urlError ? ERROR_MESSAGES[urlError] || 'Something went wrong.' : '')
  const [loading, setLoading] = useState(false)
  const [identificationCode, setIdentificationCode] = useState('')      // NEW
  const [idProofType, setIdProofType] = useState<'aadhar' | 'pan' | ''>('') // NEW
  const [idProofFile, setIdProofFile] = useState<File | null>(null)     // NEW
  const [loginMode, setLoginMode] = useState<'officer' | 'admin' | 'company' | 'manager'>('officer')
  const [companyName, setCompanyName] = useState('')      // NEW — signup
  const [apiKey, setApiKey] = useState('')                // NEW — company login
  const [pendingNotice, setPendingNotice] = useState('')  // NEW — post-signup message for companies

  const handleGoogle = () => {
    document.cookie = `auth_intent=${signup ? 'signup' : 'login'}; path=/; max-age=300; samesite=lax`
    signIn('google', { callbackUrl: '/' })
  }

  const handleSubmit = async () => {
    setError('')

    if (loginMode === 'manager') {
      if (!apiKey.trim()) return setError('Please paste your API key.')
      setLoading(true)
      const res = await signIn('credentials', { mode: 'apiKeyOnly', apiKey: apiKey.trim(), redirect: false })
      setLoading(false)
      if (res?.error) return setError(res.error)
      router.push('/')
      return
    }

    if (!email || !password) return setError('Please enter your email and password.')
    if (!isValidEmail(email)) return setError('Please enter a valid email address.')

    if (signup) {
      if (!name || !role) return setError('Please fill in all fields and select a role.')

      const passError = getPasswordError(password)
      if (passError) return setError(passError)
      if (password !== confirmPassword) return setError('Passwords do not match.')

      // NEW — compliance head signup is a separate, simpler flow with no auto-login
      if (role === 'compliance_head') {
        if (!companyName.trim()) return setError('Please enter your company name.')
        setLoading(true)
        const res = await fetch('/api/auth/company-signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, companyName: companyName.trim(), email: email.trim(), password }),
        })
        const data = await res.json()
        setLoading(false)
        if (!res.ok) return setError(data.error || 'Something went wrong.')
        setPendingNotice('Your request has been sent to the admin for approval. You will receive an email once reviewed.')
        return
      }

      if (role === 'admin' && !passkey) return setError('Admin passkey is required.')

      // NEW — officers need the invite code + ID proof instead of a free-typed city
      if (role !== 'admin') {
        if (!identificationCode.trim()) return setError('Please enter the identification code from your invitation email.')
        if (!jurisdictionCity.trim()) return setError('Please enter your jurisdiction city.')
        if (!idProofType) return setError('Please select an ID proof type.')
        if (!idProofFile) return setError('Please upload your ID proof.')
      }

      setLoading(true)

      let idProofUrl = ''
      if (role !== 'admin' && idProofFile) {
        const fd = new FormData()
        fd.append('file', idProofFile)
        fd.append('idProofType', idProofType)
        const uploadRes = await fetch('/api/upload/id-proof', { method: 'POST', body: fd })
        const uploadData = await uploadRes.json()
        if (!uploadRes.ok) { setLoading(false); return setError(uploadData.error || 'Failed to upload ID proof.') }
        idProofUrl = uploadData.url
      }

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, email: email.trim(), password, role,
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

      // NEW — pass the code through on the auto sign-in too
      const signInRes = await signIn('credentials', { email: email.trim(), password, identificationCode: identificationCode.trim(), redirect: false })
      if (signInRes?.error) {
        router.push('/login')
      } else {
        router.push('/')
      }
      return
    }

    setLoading(true)
    const res = await signIn('credentials', { email: email.trim(), password, identificationCode: identificationCode.trim(), apiKey: loginMode === 'company' ? apiKey.trim() : '', redirect: false })
    setLoading(false)

    if (res?.error) return setError(ERROR_MESSAGES[res.error] || res.error)
    router.push('/')
  }

  return (
    <main className="auth-page">
      <section className="auth-visual">
        <div className="auth-grid" />
        <div className="auth-brand"><ScanLine size={22} /> Niyam<span>AI</span></div>
        <div className="auth-copy">
          <div className="eyebrow"><span className="pulse" /> ENFORCEMENT INTELLIGENCE</div>
          <h1>Evidence-driven<br /><span>compliance.</span></h1>
          <p>Transforming field inspection from manual verification into intelligent, auditable enforcement.</p>
        </div>
        <div className="auth-scan">
          <div className="auth-package"><b>XYZ</b><small>PREMIUM BISCUITS<br />500 g</small></div>
          <i>MRP • 98%</i><i>NET QTY • 96%</i>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
            <div className="eyebrow">AUTHORIZED ACCESS</div>
            <ThemeToggle />
          </div>
          <h2>{signup ? 'Create officer account' : 'Welcome back, Officer.'}</h2>
          <p>{signup ? 'Set up your secure enforcement workspace.' : 'Sign in to your enforcement intelligence workspace.'}</p>

          {signup && (
            <label>Full name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Arjun Sen" />
            </label>
          )}

          <label>Official email / Officer ID
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@niyam.ai" />
          </label>

          <label>Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter secure password" />
            {signup && (
              <small style={{ display: 'block', color: '#64748b', fontSize: '11px', marginTop: '4px' }}>
                Must be 8+ chars with uppercase, lowercase, number & special character (@, #, $, etc.)
              </small>
            )}
          </label>

          {!signup && (
            <>
              {loginMode === 'officer' && (
                <label>Identification code
                  <input value={identificationCode} onChange={(e) => setIdentificationCode(e.target.value)} placeholder="Officers only — from your invitation email" />
                </label>
              )}
              {loginMode === 'company' && (
                <label>API key
                  <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Provided after approval" />
                </label>
              )}
              <div style={{ display: 'flex', gap: 12 }}>
                <button type="button" className="auth-admin-toggle" onClick={() => setLoginMode(loginMode === 'admin' ? 'officer' : 'admin')}>
                  {loginMode === 'admin' ? 'Continue as officer' : 'Are you an admin?'}
                </button>
                <button type="button" className="auth-admin-toggle" onClick={() => setLoginMode(loginMode === 'company' ? 'officer' : 'company')}>
                  {loginMode === 'company' ? 'Continue as officer' : 'Sign in as a company?'}
                </button>
                <button type="button" className="auth-admin-toggle" onClick={() => setLoginMode(loginMode === 'manager' ? 'officer' : 'manager')}>
                  {loginMode === 'manager' ? 'Continue as officer' : 'Product Manager?'}
                </button>
                {loginMode === 'manager' && (
                  <label>API key
                    <input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste the API key from your invite email" />
                  </label>
                )}
              </div>
            </>
          )}

          {signup && (
            <>
              <label>Confirm password
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password" />
              </label>

              <div className="role-select-list">
                {ROLES.map((r) => (
                  <label key={r.value} className="check-label">
                    <input
                      type="radio"
                      name="role"
                      value={r.value}
                      checked={role === r.value}
                      onChange={(e) => {
                        setRole(e.currentTarget.value)
                        setIdProofType('')
                        setIdProofFile(null)
                      }}
                    />
                    {r.label}
                  </label>
                ))}
              </div>

              {role === 'admin' && (
                <label>Admin passkey
                  <input type="password" value={passkey} onChange={(e) => setPasskey(e.target.value)} placeholder="Enter admin passkey" />
                </label>
              )}

              {role === 'compliance_head' && (
                <label>Company name
                  <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Acme Foods Pvt Ltd" />
                </label>
              )}

              {role !== 'admin' && role !== 'compliance_head' && role && (
                <>
                  <label>Identification code
                    <input
                      value={identificationCode}
                      onChange={(e) => setIdentificationCode(e.target.value)}
                      placeholder="Sent to you by your admin, e.g. NIYAM-XXXX-XXXX"
                    />
                  </label>

                  <label>Jurisdiction city
                    <input
                      value={jurisdictionCity}
                      onChange={(e) => setJurisdictionCity(e.target.value)}
                      placeholder="Enter your assigned city, e.g. Kolkata"
                    />
                  </label>

                  <label>ID proof type
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
                    <label>Upload {idProofType === 'aadhar' ? 'Aadhar' : 'PAN'} proof
                      <input type="file" accept="image/*,application/pdf" onChange={(e) => setIdProofFile(e.currentTarget.files?.[0] || null)} />
                    </label>
                  )}
                </>
              )}
            </>
          )}

          {error && (
            <div className="auth-error">
              <AlertCircle size={18} />
              <span>{error}</span>
            </div>
          )}

          {pendingNotice ? (
            <div className="auth-status" style={{ marginTop: 16 }}>
              <ShieldCheck size={15} />
              <span><b>Request submitted</b>{pendingNotice}</span>
            </div>
          ) : (
            <>
              <button className="button primary auth-submit" onClick={handleSubmit} disabled={loading}>
                {signup ? <UserPlus size={16} /> : <LockKeyhole size={16} />}
                {loading ? 'Please wait...' : signup ? 'Create account' : 'Sign in'}
                <ArrowRight size={16} />
              </button>

              <div className="auth-divider"><span>or</span></div>

              <button type="button" className="button secondary auth-submit auth-google-btn" onClick={handleGoogle}>
                <svg className="google-icon" width="18" height="18" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                Continue with Google
              </button>

              <p className="auth-switch" style={{ marginTop: '24px' }}>
                {signup ? 'Already registered?' : 'New enforcement officer?'}{' '}
                <a href={signup ? '/login' : '/signup'}>{signup ? 'Sign in' : 'Create account'}</a>
              </p>
            </>
          )}

          <div className="auth-status">
            <ShieldCheck size={15} />
            <span><b>SYSTEM STATUS</b>All services operational</span>
            <i />
          </div>
        </div>
      </section>
    </main>
  )
}

export function LoginPage() { return <AuthShell /> }
export function SignupPage() { return <AuthShell signup /> }
export function OnboardingPage() { return <main className="onboarding-page"><div className="onboarding-card"><div className="auth-brand"><ScanLine size={22} /> Niyam<span>AI</span></div><div className="eyebrow">OFFICER WORKSPACE / FIRST SESSION</div><h1>Welcome back, Officer.</h1><p>Your enforcement intelligence workspace is ready.</p><div className="role-card"><div className="role-icon"><ShieldCheck size={22} /></div><div><div className="eyebrow">FIELD ENFORCEMENT OFFICER</div><h2>Arjun Sen</h2><p>Kolkata, West Bengal • WB-LM-042</p></div><span className="badge badge-green">ACTIVE</span></div><div className="access-list"><span>Field inspections</span><span>AI scanner</span><span>Evidence capture</span><span>Compliance reports</span></div><a className="button primary" href="/dashboard">Enter command center <ArrowRight size={16} /></a></div></main> }
export { AuthShell }