'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, PlusCircle, UsersRound, UserRound, LogOut, ScanLine,
  Menu, PanelLeftClose, PanelLeftOpen, Sun, Moon, Building2, ClipboardCheck, Check, AlertTriangle, Clock3,
} from 'lucide-react'
import { useTheme } from 'next-themes'
import { SimpleProfileView } from '../shared/ProfileView'

function cn(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' ') }

function Logo() {
  return <div className="brand-mark"><ScanLine size={20} strokeWidth={2.5} /><span>Niyam<span>AI</span></span></div>
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  const isDark = theme === 'dark'
  return <button className="icon-button theme-toggle" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label="Toggle theme">{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
}

function Avatar({ name, image, size = 36 }: { name?: string | null; image?: string | null; size?: number }) {
  if (image) return <div className="avatar" style={{ width: size, height: size }}><img src={image} alt={name || 'User'} referrerPolicy="no-referrer" /></div>
  return <div className="avatar avatar-blank" style={{ width: size, height: size }}><UserRound size={Math.round(size * 0.55)} /></div>
}

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'dashboard' },
  { label: 'Create Manager', icon: PlusCircle, view: 'create-manager' },
  { label: 'Managers', icon: UsersRound, view: 'managers' },
  { label: 'Profile', icon: UserRound, view: 'profile' },
]

function CreateManagerView({ onCreated }: { onCreated: () => void }) {
  const [managerName, setManagerName] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [productName, setProductName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const handleSubmit = async () => {
    setError(null); setSuccess(null)
    if (!managerName.trim() || !managerEmail.trim() || !productName.trim()) {
      return setError('Please fill in all fields.')
    }
    setSending(true)
    const res = await fetch('/api/compliance/managers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ managerName, managerEmail, productName }),
    })
    const data = await res.json().catch(() => ({}))
    setSending(false)
    if (!res.ok) return setError(data.error || 'Failed to create manager.')
    setSuccess(`${managerName} has been invited to manage ${productName}. An API key was emailed to them.`)
    setManagerName(''); setManagerEmail(''); setProductName('')
    onCreated()
  }

  return (
    <div className="page-content narrow">
      <div className="page-heading"><div><div className="eyebrow"><PlusCircle size={13} /> NEW PRODUCT LINE</div><h1>Create Manager</h1><p>Assign a branch/product manager to a new product for your company.</p></div></div>
      <section className="panel create-manager-form" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14, width: '100%', maxWidth: 480, margin: '0 auto', border: '1px dashed rgba(34, 211, 238, 0.45)' }}>
        <label>Product name
          <input className="create-manager-input" value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="e.g. Salt" />
        </label>
        <label>Manager name
          <input className="create-manager-input" value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="e.g. Priya Nair" />
        </label>
        <label>Manager email
          <input className="create-manager-input" type="email" value={managerEmail} onChange={(e) => setManagerEmail(e.target.value)} placeholder="manager@example.com" />
        </label>
        {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
        {success && <p style={{ color: '#16a34a', fontSize: 12 }}>{success}</p>}
        <button className="button primary" onClick={handleSubmit} disabled={sending}>{sending ? 'Sending invite...' : 'Create & send invite'}</button>
      </section>
    </div>
  )
}

function ManagersView({ refreshKey }: { refreshKey: number }) {
  const [managers, setManagers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    fetch('/api/compliance/managers')
      .then((res) => { if (!res.ok) throw new Error('Failed to load managers'); return res.json() })
      .then((d) => setManagers(d.managers || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load managers'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  return (
    <div className="page-content">
      <div className="page-heading"><div><div className="eyebrow"><UsersRound size={13} /> TEAM</div><h1>Managers</h1><p>Product managers you've added to your company.</p></div></div>
      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
      {!loading && managers.length === 0 && <div className="empty-state panel"><h3>No managers yet</h3><p>Use "Create Manager" to add your first product manager.</p></div>}
      <div className="inspection-row-list">
        {managers.map((m) => (
          <div key={m._id} className="inspection-row">
            <div className="inspection-row-body">
              <strong>{m.name}</strong>
              <small>{m.email} • Product: {m.productName} • {new Date(m.createdAt).toLocaleDateString()}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ComplianceHeadApp() {
  const { data: session, update } = useSession()
  const [active, setActive] = useState('dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const [profileImage, setProfileImage] = useState<string | null>(null)

  useEffect(() => {
    setProfileImage(session?.user?.image || null)
  }, [session?.user?.image])

  const user = { name: session?.user?.name, image: profileImage, companyName: (session?.user as any)?.companyName }

  const handlePhotoChange = async (image: string | null) => {
    setProfileImage(image)
    await update({ image })
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await signOut({ callbackUrl: '/login', redirect: true })
  }

  let view: React.ReactNode
  if (active === 'dashboard') view = <ComplianceDashboard refreshKey={refreshKey} />
  else if (active === 'create-manager') view = <CreateManagerView onCreated={() => setRefreshKey((k) => k + 1)} />
  else if (active === 'managers') view = <ManagersView refreshKey={refreshKey} />
  else view = <SimpleProfileView user={user} roleLabel="Compliance Head" extraFields={[{ label: 'Company', value: user.companyName || '—' }]} onPhotoChange={handlePhotoChange} />

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', collapsed && 'collapsed')}>
        <div className="sidebar-head"><Logo /><button className="collapse-button" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
        <div className="workspace"><span className="workspace-dot" /><div><strong>{user.companyName || 'Company'}</strong><small>COMPLIANCE WORKSPACE</small></div></div>
        <nav>
          <div className="nav-section">MAIN</div>
          {NAV.map((item) => (
            <button key={item.view} title={item.label} className={cn('nav-item', active === item.view && 'active')} onClick={() => setActive(item.view)}>
              <item.icon size={17} /><span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation"><Menu size={20} /></button>
          <div className="top-actions">
            <div className="service-status"><i /> All systems operational</div>
            <ThemeToggle />
          </div>
          <div className="officer" style={{ cursor: 'pointer' }}>
            <div onClick={() => setActive('profile')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Go to profile">
              <Avatar name={user.name} image={user.image} />
              <div><strong>{user.name || 'Compliance Head'}</strong><small>Compliance Head</small></div>
            </div>
            <span onClick={() => setShowLogoutModal(true)} title="Sign out" style={{ display: 'inline-flex', marginLeft: 6, cursor: 'pointer' }}><LogOut size={15} color="#64748b" /></span>
          </div>
        </header>
        <main>{view}</main>
      </div>
      {showLogoutModal && (
        <div className="logout-overlay" onClick={() => !loggingOut && setShowLogoutModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="logout-icon-wrap"><LogOut size={26} /></div>
            <div className="logout-eyebrow">SECURE SESSION</div>
            <h3 className="logout-title">Sign out of NiyamAI?</h3>
            <p className="logout-desc">You will be redirected to the login page.</p>
            <div className="logout-actions">
              <button className="button secondary logout-cancel" onClick={() => setShowLogoutModal(false)} disabled={loggingOut}>Cancel</button>
              <button className="button logout-confirm" onClick={handleLogout} disabled={loggingOut}><LogOut size={16} />{loggingOut ? 'Signing out...' : 'Yes, sign out'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ComplianceDashboard({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true)
    fetch('/api/compliance/dashboard')
      .then((res) => { if (!res.ok) throw new Error('Failed to load dashboard'); return res.json() })
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard.'))
      .finally(() => setLoading(false))
  }, [refreshKey])

  if (loading) return <div className="page-content"><p style={{ color: '#64748b', fontSize: 12 }}>Loading dashboard...</p></div>
  if (error) return <div className="page-content"><p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p></div>

  const recent = data?.recent || []
  const managers = data?.managers || []
  return (
    <div className="page-content">
      <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS</div><h1>Compliance Command Center</h1><p>Monitor your product managers and their inspection activity.</p></div></div>
      <div className="stats-grid compliance-stats-grid">
        <div className="stat-card"><div className="stat-top"><span className="stat-icon blue"><ClipboardCheck size={18} /></span></div><div className="stat-value">{data?.total ?? 0}</div><div className="stat-label">Total inspections</div></div>
        <div className="stat-card"><div className="stat-top"><span className="stat-icon green"><Check size={18} /></span></div><div className="stat-value">{data?.compliant ?? 0}</div><div className="stat-label">Compliant</div></div>
        <div className="stat-card"><div className="stat-top"><span className="stat-icon red"><AlertTriangle size={18} /></span></div><div className="stat-value">{data?.nonCompliant ?? 0}</div><div className="stat-label">Non-compliant</div></div>
        <div className="stat-card"><div className="stat-top"><span className="stat-icon amber"><Clock3 size={18} /></span></div><div className="stat-value">{data?.reviewRequired ?? 0}</div><div className="stat-label">Review required</div></div>
      </div>
      <div className="dashboard-two-column">
        <section className="panel feed-panel"><div className="panel-head"><div><div className="eyebrow"><ClipboardCheck size={13} /> RECENT ACTIVITY</div><h3>Latest inspections</h3></div></div><div className="inspection-row-list">
          {recent.map((inspection: any) => <div className="inspection-row" key={inspection._id}><div className="inspection-row-body"><strong>{inspection.declaration?.product_name || inspection.premisesName || 'Unnamed inspection'}</strong><small>{inspection.officer?.name || 'Product manager'} • {inspection.status?.replace('_', ' ')} • {new Date(inspection.createdAt).toLocaleString()}</small></div></div>)}
          {!recent.length && <div className="empty-state"><h3>No inspections yet</h3><p>Your product managers' activity will appear here.</p></div>}
        </div></section>
        <section className="panel feed-panel"><div className="panel-head"><div><div className="eyebrow"><UsersRound size={13} /> PRODUCT MANAGERS</div><h3>Manager performance</h3></div></div><div className="inspection-row-list">
          {managers.map((manager: any) => <div className="inspection-row" key={manager._id}><div className="inspection-row-body"><strong>{manager.name}</strong><small>{manager.productName || 'Product'} • {manager.total} inspections • {manager.compliant} compliant • {manager.nonCompliant} non-compliant</small></div></div>)}
          {!managers.length && <div className="empty-state"><h3>No product managers yet</h3><p>Create a manager to start monitoring activity.</p></div>}
        </div></section>
      </div>
    </div>
  )
}