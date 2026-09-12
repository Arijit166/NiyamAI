'use client'

import { useEffect, useState } from 'react'
import { Building2, CheckCircle2, XCircle, Clock3 } from 'lucide-react'

type Company = {
  _id: string
  name: string
  companyName: string
  email: string
  companyStatus: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string | null
  createdAt: string
}

export function CompaniesView() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'pending' | 'approved' | 'rejected'>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reasonDraft, setReasonDraft] = useState<Record<string, string>>({})

  const load = () => {
    setLoading(true)
    fetch('/api/admin/companies')
      .then((res) => { if (!res.ok) throw new Error('Failed to load companies'); return res.json() })
      .then((d) => setCompanies(d.companies || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load companies'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const handleApprove = async (id: string) => {
    setBusyId(id)
    const res = await fetch(`/api/admin/companies/${id}/approve`, { method: 'POST' })
    setBusyId(null)
    if (res.ok) load()
  }

  const handleReject = async (id: string) => {
    setBusyId(id)
    const res = await fetch(`/api/admin/companies/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reasonDraft[id] || '' }),
    })
    setBusyId(null)
    if (res.ok) load()
  }

  const filtered = companies.filter((c) => c.companyStatus === tab)

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><Building2 size={13} /> COMPANIES</div>
          <h1>Compliance Head Requests</h1>
          <p>Review and approve companies requesting access to submit compliance data.</p>
        </div>
      </div>

      <div className="inspection-filter-group" style={{ marginBottom: 16 }}>
        <button className={`inspection-filter-chip ${tab === 'pending' ? 'active' : ''}`} onClick={() => setTab('pending')}><Clock3 size={13} /> Pending</button>
        <button className={`inspection-filter-chip ${tab === 'approved' ? 'active' : ''}`} onClick={() => setTab('approved')}><CheckCircle2 size={13} /> Approved</button>
        <button className={`inspection-filter-chip ${tab === 'rejected' ? 'active' : ''}`} onClick={() => setTab('rejected')}><XCircle size={13} /> Rejected</button>
      </div>

      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading companies...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      {!loading && filtered.length === 0 && <div className="empty-state panel"><h3>No {tab} requests</h3></div>}

      <div className="inspection-row-list">
        {filtered.map((c) => (
          <div key={c._id} className="inspection-row" style={{ flexWrap: 'wrap' }}>
            <div className="inspection-row-body" style={{ width: '100%' }}>
              <strong>{c.companyName}</strong>
              <small>{c.name} • {c.email} • {new Date(c.createdAt).toLocaleString()}</small>
              {c.companyStatus === 'rejected' && c.rejectionReason && (
                <div style={{ marginTop: 6, padding: '8px 10px', borderLeft: '3px solid #ef4444', background: 'var(--surface)' }}>
                  <span style={{ fontSize: 12, color: '#475569' }}>{c.rejectionReason}</span>
                </div>
              )}
            </div>
            {c.companyStatus === 'pending' && (
              <div style={{ display: 'flex', gap: 8, width: '100%', marginTop: 8 }}>
                <input
                  className="invite-email-input"
                  placeholder="Rejection reason (optional)"
                  value={reasonDraft[c._id] || ''}
                  onChange={(e) => setReasonDraft((d) => ({ ...d, [c._id]: e.target.value }))}
                  style={{ flex: 1 }}
                />
                <button className="button primary" disabled={busyId === c._id} onClick={() => handleApprove(c._id)}>Approve</button>
                <button className="text-button" disabled={busyId === c._id} onClick={() => handleReject(c._id)}>Reject</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}