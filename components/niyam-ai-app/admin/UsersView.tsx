'use client'

import { useState, useEffect } from 'react'
import { UserRound, ChevronRight, ClipboardCheck, CheckCircle2, XCircle, Clock3 } from 'lucide-react'

type OfficerUser = {
  _id: string
  name: string
  email: string
  image?: string | null
  role: 'executive_officer' | 'senior_officer'
  isOnline: boolean
  jurisdictionCity?: string | null
  jurisdictionState?: string | null
  identificationCode?: string | null   // NEW
  idProofType?: 'aadhar' | 'pan' | null // NEW
  idProofUrl?: string | null            // NEW
  stats: { totalInspections?: number; pending?: number; accepted?: number; rejected?: number }
  createdAt: string
}

type InspectionRow = {
  _id: string
  inspectionId: string
  premisesName: string
  location?: { address?: string; city?: string; state?: string }
  status: string
  declaration?: { product_name?: string }
  complianceResult?: { status?: string; score?: number }
  passedToSeniorOfficer?: boolean
  reviewStatus?: string
  rejectionReason?: string | null
  reviewedAt?: string | null
  createdAt: string
}

function Avatar({ name, image }: { name?: string | null; image?: string | null }) {
  if (image) return <div className="avatar" style={{ width: 36, height: 36 }}><img src={image} alt={name || 'User'} referrerPolicy="no-referrer" /></div>
  return <div className="avatar avatar-blank" style={{ width: 36, height: 36 }}><UserRound size={18} /></div>
}

function InspectionAuditRow({ insp, reviewStatus }: { insp: InspectionRow; reviewStatus?: 'pending' | 'accepted' | 'rejected' }) {
  const effectiveReviewStatus = reviewStatus || (insp.passedToSeniorOfficer ? insp.reviewStatus : undefined)
  return (
    <div className="inspection-row" style={{ flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', minWidth: 0 }}>
        <div className="inspection-row-body">
          <strong>{insp.declaration?.product_name || insp.premisesName || 'Unnamed product'}</strong>
          <small>
            {insp.location?.city ? `${insp.location.city}, ${insp.location.state || ''}` : insp.location?.address}
            {' • '}{new Date(insp.createdAt).toLocaleString()}
          </small>
        </div>
        {effectiveReviewStatus && (
          <span className={`badge ${effectiveReviewStatus === 'accepted' ? 'badge-green' : effectiveReviewStatus === 'rejected' ? 'badge-red' : 'badge-amber'}`}>
            {effectiveReviewStatus === 'pending' ? 'Pending review' : effectiveReviewStatus === 'accepted' ? 'Accepted' : 'Rejected'}
          </span>
        )}
      </div>
      {effectiveReviewStatus === 'rejected' && insp.rejectionReason && (
        <div style={{ marginTop: 2, padding: '10px 12px', borderLeft: '3px solid #ef4444', background: 'var(--surface)', width: '100%' }}>
          <strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Reason for rejection</strong>
          <span style={{ fontSize: 13, color: '#475569' }}>{insp.rejectionReason}</span>
        </div>
      )}
    </div>
  )
}

function OfficerDetail({ user, onBack }: { user: OfficerUser; onBack: () => void }) {
  const [tab, setTab] = useState<'pending' | 'accepted' | 'rejected'>('pending')
  const [rows, setRows] = useState<InspectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // NEW — city transfer state
  const [officer, setOfficer] = useState(user)
  const [transferOpen, setTransferOpen] = useState(false)
  const [newCity, setNewCity] = useState('')
  const [transferError, setTransferError] = useState<string | null>(null)
  const [transferring, setTransferring] = useState(false)

  const handleTransfer = async () => {
    setTransferError(null)
    if (!newCity.trim()) return setTransferError('Please enter a city.')
    setTransferring(true)
    const res = await fetch(`/api/admin/officers/${officer._id}/transfer-city`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jurisdictionCity: newCity.trim() }),
    })
    const data = await res.json()
    setTransferring(false)
    if (!res.ok) return setTransferError(data.error || 'Transfer failed.')
    setOfficer((o) => ({ ...o, jurisdictionCity: data.jurisdictionCity, jurisdictionState: data.jurisdictionState }))
    setTransferOpen(false)
    setNewCity('')
  }

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = officer.role === 'senior_officer'
      ? `/api/admin/users/${officer._id}/inspections?status=${tab}`
      : `/api/admin/users/${officer._id}/inspections`
    fetch(url)
      .then((res) => { if (!res.ok) throw new Error('Failed to load inspections'); return res.json() })
      .then((d) => setRows(d.inspections || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load inspections'))
      .finally(() => setLoading(false))
  }, [officer._id, officer.role, tab])

  return (
    <div>
      <button className="text-button" onClick={onBack} style={{ marginBottom: 12 }}>← Back to users</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <Avatar name={officer.name} image={officer.image} />
        <div><strong>{officer.name}</strong><br /><small style={{ color: '#64748b' }}>{officer.email}</small></div>
      </div>

      {/* NEW — identification code + jurisdiction + transfer */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        {officer.identificationCode && (
          <span className="badge badge-muted">ID: {officer.identificationCode}</span>
        )}
        <span className="badge badge-muted">
          {officer.jurisdictionCity || 'No jurisdiction'}{officer.jurisdictionState ? `, ${officer.jurisdictionState}` : ''}
        </span>
        {officer.idProofUrl && (
          <a href={officer.idProofUrl} target="_blank" rel="noreferrer" className="text-button" style={{ fontSize: 12 }}>
            View {officer.idProofType?.toUpperCase()} proof
          </a>
        )}
        <button className="text-button" style={{ fontSize: 12 }} onClick={() => setTransferOpen((v) => !v)}>
          {transferOpen ? 'Cancel' : 'Transfer city'}
        </button>
      </div>

      {transferOpen && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16 }}>
          <label className="transfer-city-field">
            New jurisdiction city
            <input className="invite-email-input" value={newCity} onChange={(e) => setNewCity(e.target.value)} placeholder="e.g. Kolkata" />
          </label>
          <button className="button primary" onClick={handleTransfer} disabled={transferring}>
            {transferring ? 'Transferring...' : 'Confirm'}
          </button>
        </div>
      )}
      {transferError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{transferError}</p>}

      {officer.role === 'senior_officer' && (
        <div className="inspection-filter-group" style={{ marginBottom: 16 }}>
          <button className={`inspection-filter-chip ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}><Clock3 size={13} /> Pending ({officer.stats.pending ?? 0})</button>
          <button className={`inspection-filter-chip ${tab === 'accepted' ? 'active' : ''}`} onClick={() => setTab('accepted')}><CheckCircle2 size={13} /> Accepted ({officer.stats.accepted ?? 0})</button>
          <button className={`inspection-filter-chip ${tab === 'rejected' ? 'active' : ''}`} onClick={() => setTab('rejected')}><XCircle size={13} /> Rejected ({officer.stats.rejected ?? 0})</button>
        </div>
      )}
      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      {!loading && !error && rows.length === 0 && <div className="empty-state panel"><h3>Nothing here yet</h3></div>}
      <div className="inspection-row-list">
        {rows.map((r) => <InspectionAuditRow key={r._id} insp={r} reviewStatus={officer.role === 'senior_officer' ? tab : undefined} />)}
      </div>
    </div>
  )
}

function InviteOfficerForm({ role, onInvited }: { role: 'executive_officer' | 'senior_officer'; onInvited: () => void }) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const handleInvite = async () => {
    setError(null)
    if (!email.trim()) return setError('Please enter an email address.')
    setSending(true)
    const res = await fetch('/api/admin/invitations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), role }),
    })
    const data = await res.json()
    setSending(false)
    if (!res.ok) return setError(data.error || 'Failed to send invite.')
    setEmail(''); setOpen(false)
    onInvited()
  }

  if (!open) {
    return <button className="button primary" onClick={() => setOpen(true)} style={{ marginBottom: 16 }}>+ Invite officer</button>
  }

  return (
    <div className="panel invite-form" style={{ padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <label className="invite-email-label">
        Email address
        <input className="invite-email-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="officer@example.com" />
      </label>
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="button primary" onClick={handleInvite} disabled={sending}>{sending ? 'Sending...' : 'Send invite'}</button>
        <button className="text-button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

export function UsersView() {
  const [users, setUsers] = useState<OfficerUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'executive_officer' | 'senior_officer'>('executive_officer')
  const [selected, setSelected] = useState<OfficerUser | null>(null)

  useEffect(() => {
    fetch('/api/admin/users')
      .then((res) => { if (!res.ok) throw new Error('Failed to load users'); return res.json() })
      .then((d) => setUsers(d.users || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load users'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = users.filter((u) => u.role === tab)

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><UserRound size={13} /> AUDIT</div>
          <h1>Users</h1>
          <p>Officer activity — inspections done, and review outcomes with reasons.</p>
        </div>
      </div>

      {selected ? (
        <section className="panel feed-panel" style={{ padding: 16 }}>
          <OfficerDetail user={selected} onBack={() => setSelected(null)} />
        </section>
      ) : (
        <>
          <InviteOfficerForm role={tab} onInvited={() => { setLoading(true); fetch('/api/admin/users').then((r) => r.json()).then((d) => setUsers(d.users || [])).finally(() => setLoading(false)) }} />
          <div className="inspection-filter-group" style={{ marginBottom: 16 }}>
            <button className={`inspection-filter-chip ${tab === 'executive_officer' ? 'active' : ''}`} onClick={() => setTab('executive_officer')}>Executive Officers</button>
            <button className={`inspection-filter-chip ${tab === 'senior_officer' ? 'active' : ''}`} onClick={() => setTab('senior_officer')}>Senior Officers</button>
          </div>

          {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading users...</p>}
          {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
          {!loading && filtered.length === 0 && <div className="empty-state panel"><h3>No {tab === 'executive_officer' ? 'Executive' : 'Senior'} Officers yet</h3><p>Accounts will appear here once they sign up.</p></div>}

          <div className="inspection-row-list">
            {filtered.map((u) => (
              <div key={u._id} className="inspection-row" onClick={() => setSelected(u)} style={{ cursor: 'pointer' }}>
                <Avatar name={u.name} image={u.image} />
                <div className="inspection-row-body">
                  <strong>{u.name}</strong>
                  <small>
                    {u.email}
                    {(u.jurisdictionCity || u.jurisdictionState) && (
                      <span style={{ marginLeft: 8, color: '#64748b' }}>
                        • {u.jurisdictionCity}{u.jurisdictionCity && u.jurisdictionState ? ', ' : ''}{u.jurisdictionState}
                      </span>
                    )}
                    {u.identificationCode && (
                      <span style={{ marginLeft: 8, color: '#64748b' }}>• ID: {u.identificationCode}</span>
                    )}
                    {u.role === 'executive_officer'
                      ? <span style={{ marginLeft: 8, color: '#64748b' }}>• <ClipboardCheck size={11} style={{ verticalAlign: -1 }} /> {u.stats.totalInspections ?? 0} inspections</span>
                      : <span style={{ marginLeft: 8, color: '#64748b' }}>• {u.stats.pending ?? 0} pending, {u.stats.accepted ?? 0} accepted, {u.stats.rejected ?? 0} rejected</span>}
                  </small>
                </div>
                <span className={`badge ${u.isOnline ? 'badge-green' : 'badge-muted'}`}>{u.isOnline ? 'Active' : 'Offline'}</span>
                <ChevronRight size={16} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}