'use client'

import { useState, useEffect } from 'react'
import { Search, Box, Eye, Check, X, ArrowLeft, Ban, Loader2, AlertTriangle } from 'lucide-react'

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

function Badge({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'muted' }) {
  return <span className={cn('badge', `badge-${tone}`)}>{children}</span>
}

type ReviewFilter = 'all' | 'pending' | 'accepted' | 'rejected'

function reviewStatusOf(insp: any): 'pending' | 'accepted' | 'rejected' {
  return insp.reviewStatus || 'pending'
}

function ReportPreviewModal({ insp, onClose }: { insp: any; onClose: () => void }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch('/api/report/pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inspectionId: insp.inspectionId,
            premisesName: insp.premisesName,
            location: insp.location?.address,
            inspectionType: insp.inspectionType,
            declaration: insp.declaration,
            result: insp.complianceResult,
            readability: insp.readability,
          }),
        })
        if (!res.ok) throw new Error('Failed to load report')
        const blob = await res.blob()
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPdfUrl(objectUrl)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load report')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    if (insp.declaration && insp.complianceResult) {
      load()
    } else {
      setLoading(false)
      setError('This case has no compliance result to report on yet.')
    }

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [insp])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: '#0f172a', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10, background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
        <button
          className="button secondary"
          onClick={onClose}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <ArrowLeft size={16} /> Back
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {loading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
            <Loader2 size={22} className="spin" /> Loading report...
          </div>
        )}
        {!loading && error && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, color: '#f87171', fontSize: 13 }}>
            <AlertTriangle size={22} /> {error}
          </div>
        )}
        {!loading && !error && pdfUrl && (
          <iframe src={pdfUrl} title="Inspection report" style={{ width: '100%', height: '100%', border: 'none' }} />
        )}
      </div>
    </div>
  )
}

function RejectReasonModal({ onCancel, onConfirm, busy }: { onCancel: () => void; onConfirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState('')
  return (
    <div className="logout-overlay" onClick={() => !busy && onCancel()}>
      <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
        <div className="logout-icon-wrap"><Ban size={26} /></div>
        <div className="logout-eyebrow">REJECT CASE</div>
        <h3 className="logout-title">Reason for rejection</h3>
        <p className="logout-desc">This will be shown to the executive officer against this case.</p>
        <textarea
          autoFocus
          placeholder="Explain what needs to be corrected..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          style={{ width: '100%', minHeight: 90, marginBottom: 12 }}
        />
        <div className="logout-actions">
          <button className="button secondary logout-cancel" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="button logout-confirm" onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={busy || !reason.trim()}>
            <Ban size={16} />{busy ? 'Rejecting...' : 'Reject case'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function SeniorReviewView() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ReviewFilter>('all')
  const [previewing, setPreviewing] = useState<any | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = () => {
    setLoading(true)
    fetch('/api/inspections')
      .then((res) => { if (!res.ok) throw new Error('Failed to load cases'); return res.json() })
      .then((data) => setItems((data.inspections || []).filter((i: any) => i.passedToSeniorOfficer)))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load cases'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const filtered = items.filter((insp) => {
    const name = (insp.declaration?.product_name || 'Unnamed product').toLowerCase()
    if (query && !name.includes(query.toLowerCase())) return false
    if (filter !== 'all' && reviewStatusOf(insp) !== filter) return false
    return true
  })

  const patchReview = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id)
    setActionError(null)
    try {
      const res = await fetch(`/api/inspections/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        throw new Error(b?.error || 'Failed to update case')
      }
      const saved = await res.json()
      setItems((prev) => prev.map((i) => (i._id === id ? saved.inspection : i)))
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to update case')
    } finally {
      setBusyId(null)
    }
  }

  const accept = (id: string) => patchReview(id, { reviewStatus: 'accepted' })
  const reject = (id: string, reason: string) =>
    patchReview(id, { reviewStatus: 'rejected', rejectionReason: reason }).then(() => setRejectingId(null))

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SENIOR REVIEW</div>
          <h1>Review queue</h1>
          <p>Cases passed to you by executive officers. Review the evidence and accept or reject each case.</p>
        </div>
      </div>

      <div className="inspection-toolbar">
        <div className="inspection-search">
          <Search size={15} />
          <input placeholder="Search by product name..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="inspection-filter-group">
          <button className={cn('inspection-filter-chip', filter === 'all' && 'active')} onClick={() => setFilter('all')}>All</button>
          <button className={cn('inspection-filter-chip', filter === 'pending' && 'active')} onClick={() => setFilter('pending')}>Pending</button>
          <button className={cn('inspection-filter-chip', filter === 'accepted' && 'active')} onClick={() => setFilter('accepted')}>Accepted</button>
          <button className={cn('inspection-filter-chip', filter === 'rejected' && 'active')} onClick={() => setFilter('rejected')}>Rejected</button>
        </div>
      </div>

      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      {actionError && <p style={{ color: '#ef4444', fontSize: 12 }}>{actionError}</p>}
      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state panel"><h3>No cases found</h3><p>Try a different search or filter.</p></div>
      )}

      <div className="inspection-row-list">
        {filtered.map((insp) => {
          const status = reviewStatusOf(insp)
          return (
            <div key={insp._id} className="inspection-row">
              <div className="inspection-row-img">
                {insp.capturedImageUrl ? <img src={insp.capturedImageUrl} alt={insp.declaration?.product_name || 'Product'} /> : <Box size={22} />}
              </div>
              <div className="inspection-row-body">
                <strong>{insp.declaration?.product_name || 'Unnamed product'}</strong>
                <small>
                  {status === 'accepted' && <Badge tone="green">Accepted</Badge>}
                  {status === 'rejected' && <Badge tone="red">Rejected</Badge>}
                  {status === 'pending' && <Badge tone="amber">Pending review</Badge>}
                  {status === 'rejected' && insp.rejectionReason && (
                    <span style={{ marginLeft: 8, color: '#64748b' }}>{insp.rejectionReason}</span>
                  )}
                </small>
              </div>
              <div className="inspection-row-action" style={{ display: 'flex', gap: 8 }}>
                <button className="button secondary" onClick={() => setPreviewing(insp)}><Eye size={14} /> View report</button>
                {status === 'pending' && (
                  <>
                    <button className="button secondary" onClick={() => accept(insp._id)} disabled={busyId === insp._id}>
                      <Check size={14} /> Accept
                    </button>
                    <button className="button secondary" onClick={() => setRejectingId(insp._id)} disabled={busyId === insp._id}>
                      <X size={14} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {previewing && <ReportPreviewModal insp={previewing} onClose={() => setPreviewing(null)} />}
      {rejectingId && (
        <RejectReasonModal
          busy={busyId === rejectingId}
          onCancel={() => setRejectingId(null)}
          onConfirm={(reason) => reject(rejectingId, reason)}
        />
      )}
    </div>
  )
}