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
  const [tab, setTab] = useState<'pending' | 'accepted' | 'rejected'>(user.role === 'senior_officer' ? 'pending' : 'pending')
  const [rows, setRows] = useState<InspectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    const url = user.role === 'senior_officer'
      ? `/api/admin/users/${user._id}/inspections?status=${tab}`
      : `/api/admin/users/${user._id}/inspections`
    fetch(url)
      .then((res) => { if (!res.ok) throw new Error('Failed to load inspections'); return res.json() })
      .then((d) => setRows(d.inspections || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load inspections'))
      .finally(() => setLoading(false))
  }, [user._id, user.role, tab])

  return (
    <div>
      <button className="text-button" onClick={onBack} style={{ marginBottom: 12 }}>← Back to users</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Avatar name={user.name} image={user.image} />
        <div><strong>{user.name}</strong><br /><small style={{ color: '#64748b' }}>{user.email}</small></div>
      </div>
      {user.role === 'senior_officer' && (
        <div className="inspection-filter-group" style={{ marginBottom: 16 }}>
          <button className={`inspection-filter-chip ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}><Clock3 size={13} /> Pending ({user.stats.pending ?? 0})</button>
          <button className={`inspection-filter-chip ${tab === 'accepted' ? 'active' : ''}`} onClick={() => setTab('accepted')}><CheckCircle2 size={13} /> Accepted ({user.stats.accepted ?? 0})</button>
          <button className={`inspection-filter-chip ${tab === 'rejected' ? 'active' : ''}`} onClick={() => setTab('rejected')}><XCircle size={13} /> Rejected ({user.stats.rejected ?? 0})</button>
        </div>
      )}
      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      {!loading && !error && rows.length === 0 && <div className="empty-state panel"><h3>Nothing here yet</h3></div>}
      <div className="inspection-row-list">
        {rows.map((r) => <InspectionAuditRow key={r._id} insp={r} reviewStatus={user.role === 'senior_officer' ? tab : undefined} />)}
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