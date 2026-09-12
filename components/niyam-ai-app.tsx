'use client'

import { useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import { EnforcementMapView } from './niyam-ai-app/admin/EnforcementMapView'
import { UsersView } from './niyam-ai-app/admin/UsersView'
import { AnalyticsView } from './niyam-ai-app/admin/AnalyticsView'
import type { ProductDeclaration, ComplianceResult } from '@/lib/rules/types'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { signOut } from 'next-auth/react'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Box, BrainCircuit, Camera, Check,
  ChevronRight, ClipboardCheck, Clock3, CloudOff, Download, Eye, FileCheck2, FileText,
  Fingerprint, Globe2, Hash, History, Info, LayoutDashboard, Menu, MapPin, Maximize2,
  PackageCheck, PanelLeftClose, PanelLeftOpen, Radar, Search, ScanLine, Sun, Moon,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload, UserRound,
  UsersRound, X, Zap, LogOut, Edit3, RefreshCw, Ban,
  BookOpen, Lightbulb, PlayCircle, FileWarning, Layers, MousePointerClick, // NEW
} from 'lucide-react'
import { SeniorReviewView } from './SeniorReviewView'

// ---------------------------------------------------------------------------
// Field metadata: how each declaration key from the microservice maps onto
// a human label + which YOLO/field-class name the recapture endpoint expects.
// ---------------------------------------------------------------------------
export const FIELD_LABELS: Record<string, string> = {
  manufacturer: 'Manufacturer',
  manufacturer_address: 'Manufacturer address',
  marketer: 'Marketer',
  mrp: 'MRP',
  net_quantity: 'Net quantity',
  manufacturing_date: 'Manufacturing date',
  batch_number: 'Batch number',
  expiry_date: 'Expiry date',
  consumer_care: 'Consumer care',
  country_of_origin: 'Country of origin',
  mfg_license_no: 'Mfg. license no.',
  mrp_tax_inclusive: 'MRP inclusive of all taxes',
  company_name: 'Company name',
  ingredients: 'Ingredients',
  product_name: 'Product name',
  // NEW: needed by the rule engine's font-height (Table-I) check. The
  // OCR/DL layer doesn't extract these yet, so they'll usually come in
  // "missing" and the officer resolves them like any other missing field.
  font_height_mm: 'Numeral / letter height (mm)',
  principal_display_panel_area_cm2: 'Principal Display Panel area (cm²)',
}

export type FieldRecord = {
  value: string | null
  confidence: number
  source?: string | null
  status: 'extracted' | 'manual' | 'not_applicable' | 'missing'
  reason?: string | null
  fontHeightMm?: number | null                     // final mm, set once officer confirms block size
  fontHeightPerMmUnit?: number | null              // NEW — raw ratio from backend, pre-calibration
  fontHeightConfidence?: string | null
  fontHeightUncertaintyPerMmUnit?: number | null   // NEW
}

// Shape of the details collected on the Inspection screen, held in memory
// only, until the officer finishes the whole flow and saves the case.
export type InspectionDraft = {
  inspectionType: string
  premisesName: string
  notes: string
  location: { address: string; city?: string; state?: string; lat?: number; lng?: number }
}

const nav = [
  { label: 'Overview', icon: LayoutDashboard, view: 'overview', section: 'COMMAND', roles: ['admin', 'executive_officer', 'senior_officer'] },
  { label: 'New Inspection', icon: ScanLine, view: 'inspection', section: 'OPERATIONS', accent: true, roles: ['executive_officer'] },
  { label: 'Inspections', icon: ClipboardCheck, view: 'history', section: 'OPERATIONS', roles: ['executive_officer'] },
  { label: 'Review Queue', icon: Eye, view: 'review-queue', section: 'OPERATIONS', roles: ['senior_officer'] },
  { label: 'Guidelines', icon: BookOpen, view: 'guidelines', section: 'OPERATIONS', roles: ['executive_officer', 'senior_officer'] }, // NEW
  { label: 'Enforcement Map', icon: Radar, view: 'enforcement-map', section: 'INTELLIGENCE', roles: ['admin'] },
  { label: 'Users', icon: UsersRound, view: 'admin-users', section: 'INTELLIGENCE', roles: ['admin'] },
  { label: 'Analytics', icon: BarChart3, view: 'analytics', section: 'INTELLIGENCE', roles: ['admin'] },
  { label: 'Profile', icon: UserRound, view: 'profile', section: 'OPERATIONS', roles: ['admin', 'executive_officer', 'senior_officer'] },
]

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  executive_officer: 'Executive Officer',
  senior_officer: 'Senior Officer',
}

function Avatar({ name, image, size = 36 }: { name?: string | null; image?: string | null; size?: number }) {
  if (image) {
    return <div className="avatar" style={{ width: size, height: size }}><img src={image} alt={name || 'User'} referrerPolicy="no-referrer" /></div>
  }
  return <div className="avatar avatar-blank" style={{ width: size, height: size }}><UserRound size={Math.round(size * 0.55)} /></div>
}

const inspections = [
  ['XYZ Premium Biscuits', 'Kolkata • Ward 12', 'Field Unit 04', 'Review required', '68', '2m ago'],
  ['Bharat Fresh Detergent', 'Howrah • Market Road', 'Field Unit 02', 'Compliant', '96', '18m ago'],
  ['Aarogya Herbal Shampoo', 'Salt Lake • Sector V', 'Field Unit 07', 'Violation detected', '41', '42m ago'],
  ['DailyHarvest Tea', 'Durgapur • City Centre', 'Field Unit 03', 'Review required', '74', '1h ago'],
]

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

function Logo() {
  return <div className="brand-mark"><ScanLine size={20} strokeWidth={2.5} /><span>Niyam<span>AI</span></span></div>
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  const isDark = theme === 'dark'
  return <button className="icon-button theme-toggle" onClick={() => setTheme(isDark ? 'light' : 'dark')} aria-label="Toggle theme" title="Toggle theme">{isDark ? <Sun size={18} /> : <Moon size={18} />}</button>
}

function Badge({ children, tone = 'cyan' }: { children: React.ReactNode; tone?: 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'muted' }) {
  return <span className={cn('badge', `badge-${tone}`)}>{children}</span>
}

function StatCard({ icon: Icon, label, value, change, tone, data }: { icon: React.ElementType; label: string; value: string; change: string; tone: string; data: number[] }) {
  return <div className="stat-card">
    <div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={18} /></span><span className="stat-change">{change}</span></div>
    <div className="stat-value">{value}</div><div className="stat-label">{label}</div>
    <div className="sparkline" aria-hidden="true">{data.map((height, i) => <i key={i} style={{ height: `${height}%` }} />)}</div>
  </div>
}

function Topbar({ onMenu, onLogout, user, go }: {
  onMenu: () => void
  onLogout: () => void
  go: (v: string) => void   // NEW
  user: { name?: string | null; image?: string | null; role?: string | null; jurisdictionCity?: string | null; jurisdictionState?: string | null }
}) {
  const location = user.jurisdictionCity
    ? `${user.jurisdictionCity}${user.jurisdictionState ? `, ${user.jurisdictionState}` : ''}`
    : 'Location not set'
  return <header className="topbar">
    <button className="mobile-menu icon-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
    <div className="top-actions">
      <div className="location"><MapPin size={15} /><span>{location}</span><ChevronRight size={13} /></div>
      <div className="service-status"><i /> All systems operational</div><ThemeToggle /><button className="icon-button notification"></button>
    </div>
      <div className="officer" style={{ cursor: 'pointer' }}>
        <div onClick={() => go('profile')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Go to profile">
          <Avatar name={user.name} image={user.image} size={36} />
          <div><strong>{user.name || 'Officer'}</strong><small>{ROLE_LABELS[user.role || ''] || 'Officer'}</small></div>
        </div>
        <span
          onClick={onLogout}
          title="Sign out"
          style={{ display: 'inline-flex', marginLeft: 6, cursor: 'pointer' }}
        >
          <LogOut size={15} color="#64748b" />
        </span>
      </div>
  </header>
}

function Sidebar({ active, setActive, collapsed, setCollapsed, user }: { active: string; setActive: (v: string) => void; collapsed: boolean; setCollapsed: (v: boolean) => void; user: { name?: string | null; image?: string | null; role?: string | null } }) {
  let current = ''
  const visibleNav = nav.filter((item) => !('roles' in item) || (item as any).roles.includes(user.role))
  return <aside className={cn('sidebar', collapsed && 'collapsed')}>
    <div className="sidebar-head"><Logo /><button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    <div className="workspace"><span className="workspace-dot" /><div><strong>AI Compliance</strong><small>INTELLIGENCE PLATFORM</small></div></div>
    <nav>{visibleNav.map((item) => { const show = current !== item.section; current = item.section; return <div key={item.view}>{show && !collapsed && <div className="nav-section">{item.section}</div>}<button title={item.label} className={cn('nav-item', active === item.view && 'active', item.accent && 'accent')} onClick={() => setActive(item.view)}><item.icon size={17} /><span>{item.label}</span>{item.accent && <span className="live-dot" />}</button></div> })}</nav>
  </aside>
}

function Dashboard({ go, role }: { go: (view: string) => void; role?: string | null }) {
  const [data, setData] = useState<any | null>(null)
  const [analytics, setAnalytics] = useState<any | null>(null)   // NEW
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const requests = [fetch('/api/dashboard/overview').then((res) => res.json())]
    if (role === 'admin') {
      requests.push(fetch('/api/admin/analytics').then((res) => res.json()))   // NEW
    }
    Promise.all(requests)
      .then(([overview, analyticsData]) => {
        setData(overview)
        if (analyticsData) setAnalytics(analyticsData)   // NEW
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [role])   // MODIFIED — added role dependency

  if (loading) return <div className="page-content"><p style={{ color: '#64748b', fontSize: 12 }}>Loading dashboard...</p></div>

  const recentRow = (r: any, sub: string) => (
    <div key={r._id} className="inspection-row">
      <div className="inspection-row-body">
        <strong>{r.declaration?.product_name || r.premisesName || 'Unnamed product'}</strong>
        <small>{sub}</small>
      </div>
    </div>
  )

  if (role === 'executive_officer') {
    const recent = data?.recent || []
    return <div className="page-content">
      <div className="page-heading">
        <div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS</div><h1>Enforcement Command Center</h1><p>Your inspections at a glance.</p></div>
        <div className="heading-actions"><button className="button primary" onClick={() => go('inspection')}><ScanLine size={16} /> Start inspection <ArrowRight size={16} /></button></div>
      </div>
      <div className="stats-grid">
        <StatCard icon={ClipboardCheck} label="Total inspections" value={String(data?.total ?? 0)} change="" tone="blue" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={Check} label="Compliant" value={String(data?.compliant ?? 0)} change="" tone="green" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={AlertTriangle} label="Non-compliant" value={String(data?.nonCompliant ?? 0)} change="" tone="red" data={[40,50,60,55,70,65,80]} />
      </div>
      <section className="panel feed-panel">
        <div className="panel-head"><div><div className="eyebrow"><Activity size={13} /> RECENT</div><h3>Recent inspections</h3></div><button className="text-button" onClick={() => go('history')}>More <ArrowRight size={14} /></button></div>
        <div className="inspection-row-list">
          {recent.map((r: any) => recentRow(r, `${r.location?.city || ''}${r.location?.state ? `, ${r.location.state}` : ''} • ${new Date(r.createdAt).toLocaleString()}`))}
          {recent.length === 0 && <div className="empty-state panel"><h3>No inspections yet</h3></div>}
        </div>
      </section>
    </div>
  }

  if (role === 'senior_officer') {
    const recent = data?.recent || []
    return <div className="page-content">
      <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS</div><h1>Review Command Center</h1><p>Your review activity at a glance.</p></div></div>
      <div className="stats-grid">
        <StatCard icon={Eye} label="Reviews done" value={String(data?.reviewsDone ?? 0)} change="" tone="blue" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={Check} label="Accepted" value={String(data?.accepted ?? 0)} change="" tone="green" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={X} label="Rejected" value={String(data?.rejected ?? 0)} change="" tone="red" data={[40,50,60,55,70,65,80]} />
      </div>
      <section className="panel feed-panel">
        <div className="panel-head"><div><div className="eyebrow"><Activity size={13} /> RECENT</div><h3>Recently reviewed</h3></div><button className="text-button" onClick={() => go('review-queue')}>More <ArrowRight size={14} /></button></div>
        <div className="inspection-row-list">
          {recent.map((r: any) => recentRow(r, `${r.reviewStatus === 'accepted' ? 'Accepted' : 'Rejected'} • ${r.reviewedAt ? new Date(r.reviewedAt).toLocaleString() : ''}`))}
          {recent.length === 0 && <div className="empty-state panel"><h3>No reviews yet</h3></div>}
        </div>
      </section>
    </div>
  }

  if (role === 'admin') {
    return <div className="page-content">
      <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS</div><h1>Enforcement Command Center</h1><p>Platform-wide overview.</p></div></div>
      <div className="stats-grid">
        <StatCard icon={UsersRound} label="Executive officers" value={String(data?.executiveOfficers ?? 0)} change="" tone="blue" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={UsersRound} label="Senior officers" value={String(data?.seniorOfficers ?? 0)} change="" tone="purple" data={[40,50,60,55,70,65,80]} />
        <StatCard icon={History} label="Repeated violations" value={String(data?.repeatedViolations ?? 0)} change="" tone="amber" data={[40,50,60,55,70,65,80]} />
      </div>
      {/* NEW — violation trends chart, pulled from /api/admin/analytics */}
      {/* NEW — violation trends chart, pulled from /api/admin/analytics */}
          <section className="panel" style={{ padding: 16, marginBottom: 20 }}>
            <div className="eyebrow"><AlertTriangle size={13} /> MOST COMMON VIOLATIONS</div>
            <h3 style={{ marginBottom: 12 }}>Top violation types</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={analytics?.mostCommonViolations || []} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis type="number" stroke="#64748b" fontSize={11} />
                  <YAxis type="category" dataKey="title" stroke="#64748b" fontSize={11} width={160} />
                  <Tooltip contentStyle={{ background: '#0f172a', border: '1px solid #1e293b' }} />
                  <Bar dataKey="count" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {(!analytics?.mostCommonViolations || analytics.mostCommonViolations.length === 0) && (
              <p style={{ color: '#64748b', fontSize: 13 }}>No violations recorded yet.</p>
            )}
          </section>
    </div>
  }

  return <div className="page-content"><p style={{ color: '#64748b', fontSize: 12 }}>No dashboard data.</p></div>
}

function InspectionTable({ rows, go }: { rows: string[][]; go: (v: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>LOCATION</th><th>OFFICER</th><th>STATUS</th><th>SCORE</th><th>TIME</th><th /></tr></thead><tbody>{rows.map((r) => <tr key={r[0]} onClick={() => go('product')}><td><strong>{r[0]}</strong><small className="mobile-sub">{r[1]}</small></td><td>{r[1]}</td><td>{r[2]}</td><td><Badge tone={r[3] === 'Compliant' ? 'green' : r[3] === 'Violation detected' ? 'red' : 'amber'}><i className="status-dot" /> {r[3]}</Badge></td><td><b className={cn('score', Number(r[4]) > 80 ? 'good' : Number(r[4]) > 60 ? 'warn' : 'bad')}>{r[4]}</b></td><td>{r[5]}</td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>
}

function ProgressSteps({ active = 1 }: { active?: number }) {
  return <div className="progress-steps">{['Inspection', 'Capture', 'AI analysis', 'Compliance', 'Review', 'Report'].map((step, i) => <div className={cn('progress-step', i < active && 'done', i === active && 'current')} key={step}><span>{i < active ? <Check size={13} /> : `0${i + 1}`}</span><small>{step}</small></div>)}</div>
}

// ---------------------------------------------------------------------------
// STEP 1 — Inspection details are collected in memory only. Nothing is
// written to the DB here; onCreated hands the draft object up to the app
// shell, which is only persisted at the very end in handleSaveCase.
// ---------------------------------------------------------------------------
function InspectionView({ go, onCreated }: { go: (v: string) => void; onCreated: (draft: InspectionDraft) => void }) {
  const [inspectionType, setInspectionType] = useState('Physical store')
  const [premisesName, setPremisesName] = useState('')
  const [notes, setNotes] = useState('')
  const [address, setAddress] = useState('Detecting location...')
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [detectedCity, setDetectedCity] = useState('')
  const [detectedState, setDetectedState] = useState('')
  const [resolving, setResolving] = useState(false)          // NEW
  const geocodeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)   // NEW

  // NEW — forward-geocodes whatever the officer typed (a city name, a
  // state name, a full address, anything) into a proper city + state pair,
  // the same shape reverse-geocoding produces off GPS. This is what makes
  // manual typing land correctly in analytics/enforcement map, which group
  // strictly by location.state / location.city.
  const resolveLocationText = async (text: string) => {
    const query = text.trim()
    if (!query || query === 'Detecting location...') return
    setResolving(true)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&countrycodes=in&q=${encodeURIComponent(query)}`,
        { headers: { Accept: 'application/json' } }
      )
      const results = await res.json()
      const match = results?.[0]
      if (!match) return // leave existing detectedCity/detectedState untouched
      const a = match.address || {}
      const city = a.city || a.town || a.village || a.county || ''
      const state = a.state || ''
      setDetectedCity(city)
      setDetectedState(state)
      if (match.lat && match.lon) setCoords({ lat: parseFloat(match.lat), lng: parseFloat(match.lon) })
    } catch {
      // network hiccup — keep whatever was last resolved, officer can still save
    } finally {
      setResolving(false)
    }
  }

  // NEW — debounced so we're not hitting Nominatim on every keystroke.
  const handleAddressChange = (value: string) => {
    setAddress(value)
    if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current)
    geocodeDebounce.current = setTimeout(() => resolveLocationText(value), 700)
  }

  useEffect(() => () => { if (geocodeDebounce.current) clearTimeout(geocodeDebounce.current) }, []) // NEW cleanup

  const detectLocation = () => {
    if (!navigator.geolocation) { setAddress('Location unavailable — enter manually'); return }
    setAddress('Detecting location...')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        setCoords({ lat: latitude, lng: longitude })
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
            { headers: { Accept: 'application/json' } }
          )
          const data = await res.json()
          const a = data.address || {}
          const city = a.city || a.town || a.village || a.county || 'Unknown city'
          const state = a.state || ''
          setDetectedCity(city)
          setDetectedState(state)
          setAddress(state ? `${city}, ${state}` : city)
        } catch {
          setAddress('Could not detect city — enter manually')
        }
      },
      () => setAddress('Location permission denied — enter manually'),
    )
  }

  useEffect(() => { detectLocation() }, [])

  const handleContinue = () => {
    onCreated({ inspectionType, premisesName, notes, location: { address, city: detectedCity, state: detectedState, ...coords } })
    go('capture')
  }
  return <div className="page-content narrow">
    <div className="page-heading"><div><div className="eyebrow">WORKFLOW / 01</div><h1>New inspection</h1><p>Create an evidence trail for a new packaged commodity inspection.</p></div><Badge tone="green"><CloudOff size={13} /> Offline-ready</Badge></div>
    <ProgressSteps active={0} />
    <div className="form-layout">
      <section className="panel form-panel">
        <div className="section-title"><div className="step-number">01</div><div><h3>Inspection details</h3><p>Tell us where this inspection is happening.</p></div></div>
        <div className="form-grid">
          <label>Inspection type<select value={inspectionType} onChange={(e) => setInspectionType(e.target.value)}><option>Physical store</option><option>Supermarket</option><option>Warehouse</option><option>E-Commerce</option></select></label>
          <label className="wide">
            Location
            <div className="input-with-action">
              <input value={address} onChange={(e) => handleAddressChange(e.target.value)} placeholder="City, state, or use current location" />
              <button type="button" className="inline-action" onClick={detectLocation}><MapPin size={15} /> Use current location</button>
            </div>
            {resolving && <small style={{ color: '#64748b' }}>Resolving location...</small>}
          </label>
          <label className="wide">Premises / shop name<input placeholder="Enter premises name" value={premisesName} onChange={(e) => setPremisesName(e.target.value)} /></label>
          <label className="wide">Inspection notes<textarea placeholder="Add observations for the audit trail..." value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        <div className="form-footer"><span><ShieldCheck size={15} /> All changes are audit logged</span><button className="button primary" onClick={handleContinue}>Continue to capture <ArrowRight size={16} /></button></div>
      </section>
      <aside className="panel workflow-aside">
        <div className="eyebrow cyan-text"><Zap size={13} /> YOUR WORKFLOW</div><h3>AI-guided evidence</h3>
        <p>Capture one photo of the package. NiyamAI extracts every declaration it can and only asks you about what's still missing.</p>
        <div className="workflow-list"><div><Check size={15} /> Capture one package photo</div><div><Check size={15} /> Extract declarations</div><div><Check size={15} /> Resolve anything missing</div><div><Check size={15} /> Evaluate configured rules</div></div>
      </aside>
    </div>
  </div>
}

// ---------------------------------------------------------------------------
// STEP 2 — Capture (single image only: camera capture or upload).
// `inspectionId` here is a temporary client-side id (see NiyamAIApp), used
// only to tag the OCR calls — nothing is persisted to Mongo until the end.
// ---------------------------------------------------------------------------
// AFTER
function CaptureView({ go, inspectionId, onExtracted, onImageCaptured, onReadability }: { go: (v: string) => void; inspectionId: string | null; onExtracted: (fields: Record<string, FieldRecord>) => void; onImageCaptured?: (base64: string) => void; onReadability?: (readability: any) => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [markerDetected, setMarkerDetected] = useState(false)
  const [pendingFields, setPendingFields] = useState<Record<string, FieldRecord> | null>(null)
  const [markerSizeInput, setMarkerSizeInput] = useState('')

  const stopStream = () => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; setStreaming(false) }

  // Tries the requested facing mode first (back camera on phones), then
  // falls back to whatever camera the device actually has — laptops only
  // expose a front camera, so `environment` alone would just fail silently.
  const startStream = async (mode: 'environment' | 'user' = facingMode) => {
    setError(null)
    stopStream()
    try {
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: mode } } })
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true })
      }
      streamRef.current = stream
      setStreaming(true)
      setPreview(null)
      setFile(null)
    } catch {
      setStreaming(false) // no camera / permission denied -> upload button still works
    }
  }

  useEffect(() => { startStream('environment'); return () => stopStream() }, [])

  // Attach the stream once the <video> element is actually mounted. This
  // must be a separate effect from startStream: the element only exists
  // in the DOM after `streaming` flips true and React re-renders, so
  // assigning srcObject synchronously inside startStream (before that
  // render happens) was silently attaching to a stale/unmounted node —
  // that's what caused the frozen/blurry preview after "Retake".
  useEffect(() => {
    if (streaming && !preview && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current
      videoRef.current.play().catch(() => {})
    }
  }, [streaming, preview])

  const flipCamera = () => {
    const next = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(next)
    startStream(next)
  }

  const capturePhoto = () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const captured = new File([blob], 'capture.jpg', { type: 'image/jpeg' })
      setFile(captured)
      setPreview(URL.createObjectURL(captured))
      stopStream()
    }, 'image/jpeg', 0.92)
  }

  const retake = () => { setPreview(null); setFile(null); startStream(facingMode) }

  const handleFile = (f: File | null) => {
    if (!f) return
    stopStream()
    setFile(f)
    setPreview(URL.createObjectURL(f))
    setError(null)
  }

  const analyze = async () => {
    if (!file || !inspectionId) return
    setUploading(true)
    setError(null)
    try {
      if (onImageCaptured) {
        try {
          onImageCaptured(await fileToThumbnailBase64(file))
        } catch { /* thumbnail is best-effort, never block the actual extraction */ }
      }
      const form = new FormData()
      form.append('inspectionId', inspectionId)
      form.append('image', file)
      form.append('markerSizeMm', '20')
    
      const res = await fetch('/api/microservice/extract', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Extraction failed')
      const { structuredData, readability, markerDetected: detected } = await res.json()
      onReadability?.(readability || null)
      if (detected) {
        setPendingFields(structuredData)
        setMarkerDetected(true)   // hold here — prompt for the block's real size before moving on
      } else {
        onExtracted(structuredData)
        go('extraction')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed. Please retry.')
    } finally {
      setUploading(false)
    }
  }

    const confirmMarkerSize = () => {
    const sizeMm = parseFloat(markerSizeInput)
    if (!pendingFields || !sizeMm || sizeMm <= 0) return
    const calibrated: Record<string, FieldRecord> = {}
    for (const [name, field] of Object.entries(pendingFields)) {
      if (!field.fontHeightPerMmUnit) {
        calibrated[name] = field
        continue
      }
      const calibratedMm = Math.round(field.fontHeightPerMmUnit * (sizeMm / 20) * 100) / 100
      calibrated[name] = {
        ...field,
        fontHeightMm: calibratedMm,
        ...(name === 'font_height_mm' ? { value: String(calibratedMm) } : {}),
      }
    }
    onExtracted(calibrated)
    setMarkerDetected(false)
    setPendingFields(null)
    go('extraction')
  }

  return <div className="page-content capture-page">
    <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE CAMERA {inspectionId ? `/ ${inspectionId}` : ''}</div><h1>Capture the package</h1><p>One clear photo of the label is enough — NiyamAI will tell you what's still missing after analysis.</p></div><Badge tone="amber"><CloudOff size={13} /> Offline inspection mode</Badge></div>
    <ProgressSteps active={1} />
    <div className="capture-layout">
      <section className="camera-panel">
        <div className="camera-toolbar">
          <span><i className="record-dot" /> {streaming ? 'Live camera' : 'Single capture'}</span>
          {streaming && <button className="icon-button" onClick={flipCamera} title="Switch camera"><RefreshCw size={16} /></button>}
        </div>
        <div className="camera-view" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {preview
            ? <img src={preview} alt="Captured package" style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain', borderRadius: 12 }} />
            : streaming
              ? <video ref={videoRef} muted playsInline style={{ maxHeight: '100%', maxWidth: '100%', borderRadius: 12 }} />
              : <div className="camera-tip"><ScanLine size={16} /> No camera available — upload a photo instead</div>}
        </div>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files?.[0] || null)} />
        <div className="camera-controls">
          <button className="button ghost" onClick={() => inputRef.current?.click()}><Upload size={16} /> Upload image</button>
          {streaming && !preview && <button className="shutter" onClick={capturePhoto}><span /></button>}
          {preview && <button className="button ghost" onClick={retake}><RefreshCw size={16} /> Retake</button>}
          <button className="button primary" onClick={analyze} disabled={!file || uploading}>{uploading ? 'Analyzing...' : 'Analyze package'} <ArrowRight size={16} /></button>
        </div>
        {error && <p style={{ color: '#ef4444', fontSize: 12, padding: '0 16px' }}>{error}</p>}
      </section>
      <aside className="panel assistant-panel">
        <div className="assistant-header"><span className="ai-orb"><BrainCircuit size={18} /></span><div><div className="eyebrow purple-text">INSPECTION ASSISTANT</div><strong>How this works</strong></div></div>
        <div className="assistant-message"><Sparkles size={16} /><p><strong>Single photo, full pipeline</strong>Your capture goes through OCR + LLM correction + the deterministic rule engine. Anything it can't read gets flagged for you on the next screen — recapture just that spot, type it in, or mark it not applicable.</p></div>
      </aside>
    </div>
    {markerDetected && (
      <div className="logout-overlay">
        <div className="logout-modal">
          <div className="logout-icon-wrap"><ScanLine size={26} /></div>
          <div className="logout-eyebrow">REFERENCE BLOCK DETECTED</div>
          <h3 className="logout-title">Enter the block's real size</h3>
          <p className="logout-desc">A calibration marker was found in the photo. Enter its actual size in millimetres to convert detected text heights to mm.</p>
          <input
            type="number"
            min={1}
            step="0.1"
            autoFocus
            placeholder="e.g. 20"
            value={markerSizeInput}
            onChange={(e) => setMarkerSizeInput(e.target.value)}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <div className="logout-actions">
            <button className="button primary logout-confirm" onClick={confirmMarkerSize} disabled={!markerSizeInput}>Confirm & continue</button>
          </div>
        </div>
      </div>
    )}
  </div>
}

// ---------------------------------------------------------------------------
// STEP 3 — Extraction. Missing fields get a 3-option resolver: recapture
// (once) -> type manually -> not applicable. Since no DB record exists yet
// (case isn't saved until the end), resolved values are kept in local
// `fields` state only — no PATCH to /api/inspections/:id happens here.
// ---------------------------------------------------------------------------
function MissingFieldResolver({ inspectionId, name, onResolved }: { inspectionId: string; name: string; onResolved: (rec: FieldRecord) => void }) {
  const [mode, setMode] = useState<'options' | 'manual'>('options')
  const [manualValue, setManualValue] = useState('')
  const [recaptureTried, setRecaptureTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const recapture = async (f: File) => {
    setBusy(true)
    try {
      const form = new FormData()
      form.append('inspectionId', inspectionId)
      form.append('fieldName', name)
      form.append('image', f)
      const res = await fetch('/api/microservice/extract-field', { method: 'POST', body: form })
      const { field } = await res.json()
      setRecaptureTried(true)
      if (field.status === 'extracted') onResolved(field)
    } finally {
      setBusy(false)
    }
  }

  const saveManual = () => {
    if (!manualValue.trim()) return
    onResolved({ value: manualValue.trim(), confidence: 1, source: 'manual', status: 'manual' })
  }

  const markNotApplicable = () => {
    onResolved({ value: null, confidence: 0, status: 'not_applicable', reason: 'Marked not applicable by officer' })
  }

  if (name === 'font_height_mm') {
    return <div className="declaration-field field-warning">
      <label>
        {FIELD_LABELS[name] || name}
        <span className="low-confidence" style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}>
          ArUco cannot be detected — enter font size manually
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <input
          autoFocus
          type="number"
          step="0.1"
          min={0.5}
          placeholder="Enter font size in mm (e.g. 2.0)"
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <button className="edit-button" onClick={saveManual} disabled={busy || !manualValue.trim()} style={{ height: 38 }}>
          <Check size={14} /> Save font size
        </button>
      </div>
      <small style={{ color: '#64748b', marginTop: 4, display: 'block' }}>
        ArUco calibration marker was not detected. Enter the physical printed letter/numeral height in millimetres.
      </small>
    </div>
  }

  if (name === 'principal_display_panel_area_cm2') {
    return <div className="declaration-field field-warning">
      <label>
        {FIELD_LABELS[name] || name}
        <span className="low-confidence" style={{ background: '#fef3c7', color: '#b45309', borderColor: '#fde68a' }}>
          Required for Table-I compliance check
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <input
          type="number"
          step="0.1"
          min={0.1}
          placeholder="Enter panel area in cm² (e.g. 40)"
          value={manualValue}
          onChange={(e) => setManualValue(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        <button className="edit-button" onClick={saveManual} disabled={busy || !manualValue.trim()} style={{ height: 38 }}>
          <Check size={14} /> Save area
        </button>
      </div>
      <small style={{ color: '#64748b', marginTop: 4, display: 'block' }}>
        Measure the Principal Display Panel area (length × height in cm²) to verify font height compliance under Table-I.
      </small>
    </div>
  }

  if (mode === 'manual') {
    return <div className="declaration-field field-warning">
      <label>{FIELD_LABELS[name] || name}</label>
      <div><input autoFocus placeholder="Type the value from the label" value={manualValue} onChange={(e) => setManualValue(e.target.value)} /><button className="edit-button" onClick={saveManual} disabled={busy}>Save</button></div>
    </div>
  }

  return <div className="declaration-field field-warning">
    <label>{FIELD_LABELS[name] || name}<span className="low-confidence">Missing</span></label>
    <div className="field-actions">
      <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && recapture(e.target.files[0])} />
      {!recaptureTried && <button className="edit-button" onClick={() => fileRef.current?.click()} disabled={busy}><RefreshCw size={13} /> Capture again</button>}
      <button className="edit-button" onClick={() => setMode('manual')} disabled={busy}><Edit3 size={13} /> Type manually</button>
      <button className="edit-button" onClick={markNotApplicable} disabled={busy}><Ban size={13} /> Not applicable</button>
    </div>
    {recaptureTried && <small>Still not legible — type it manually or mark not applicable.</small>}
  </div>
}

function ExtractionView({ go, inspectionId, fields, setFields, isImported, setIsImported }: {
  go: (v: string) => void
  inspectionId: string | null
  fields: Record<string, FieldRecord>
  setFields: (f: Record<string, FieldRecord>) => void
  isImported: boolean
  setIsImported: (v: boolean) => void
}) {
  const entries = Object.entries(fields)
  const missingCount = entries.filter(([, f]) => f.status === 'missing').length
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')

  const resolve = (name: string, rec: FieldRecord) => setFields({ ...fields, [name]: rec })

  const startEdit = (name: string, current: FieldRecord) => {
    setEditingField(name)
    setEditValue(current.status === 'not_applicable' ? '' : current.value || '')
  }

  const saveEdit = (name: string) => {
    const trimmed = editValue.trim()
    if (!trimmed) return
    resolve(name, { value: trimmed, confidence: 1, source: 'manual', status: 'manual' })
    setEditingField(null)
  }

  const cancelEdit = () => setEditingField(null)

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow">WORKFLOW / 03 • HUMAN-IN-THE-LOOP</div><h1>Declaration extraction</h1><p>Review what NiyamAI read off the package before running the compliance check.</p></div><Badge tone={missingCount ? 'amber' : 'green'}>{missingCount ? `${missingCount} need attention` : 'All fields resolved'}</Badge></div>
    <ProgressSteps active={2} />
    <section className="panel declaration-form" style={{ marginTop: 20 }}>
      <div className="eyebrow">STRUCTURED DECLARATIONS</div>
      <h3>Officer verification</h3>
      {entries.length === 0 && <p>No extraction result yet — go back and capture a photo.</p>}
      {entries.map(([name, f]) => {
        if (f.status === 'missing' && inspectionId) {
          return <MissingFieldResolver key={name} inspectionId={inspectionId} name={name} onResolved={(rec) => resolve(name, rec)} />
        }
        if (editingField === name) {
          return <div className="declaration-field field-editing" key={name}>
            <label>{FIELD_LABELS[name] || name}</label>
            <div>
              <input autoFocus placeholder="Enter value" value={editValue} onChange={(e) => setEditValue(e.target.value)} />
              <div className="field-actions">
                <button className="edit-button" onClick={() => saveEdit(name)}><Check size={13} /> Save</button>
                <button className="edit-button" onClick={cancelEdit}><X size={13} /> Cancel</button>
              </div>
            </div>
          </div>
        }
        return <div className="declaration-field" key={name}>
          <label>{FIELD_LABELS[name] || name}<span>{f.status === 'manual' ? 'entered manually' : f.status === 'not_applicable' ? 'not applicable' : `${Math.round((f.confidence || 0) * 100)}% confidence`}</span></label>
          <div>
            <input value={f.status === 'not_applicable' ? 'Not applicable' : f.value || ''} readOnly />
            <button className="edit-button" onClick={() => startEdit(name, f)}><Edit3 size={13} /> Edit</button>
          </div>
        </div>
      })}
      <div className="human-note"><UserRound size={15} /><span><b>Human verification required</b>  AI suggestions are never final findings.</span></div>
      {/* NEW: explicit imported-product toggle. Country-of-origin presence
          alone was too fragile a signal for is_imported (a domestic label
          can legitimately mention a raw-material origin), so this is a
          direct officer decision instead of an inferred heuristic. */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0', fontSize: 13 }}>
        <input type="checkbox" checked={isImported} onChange={(e) => setIsImported(e.target.checked)} />
        This is an imported product (requires country of origin under Rule 6)
      </label>
      <button className="button primary full" onClick={() => go('analysis')} disabled={missingCount > 0}>
        {missingCount > 0 ? `Resolve ${missingCount} field(s) to continue` : 'Confirm & run compliance check'} <ArrowRight size={16} />
      </button>
    </section>
  </div>
}

function AnalysisView({ go, declaration, onResult }: { go: (v: string) => void; declaration: ProductDeclaration; onResult: (result: ComplianceResult) => void }) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const runAnalysis = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/compliance/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(declaration) })
      if (!res.ok) { const body = await res.json().catch(() => null); throw new Error(body?.error || `Request failed with status ${res.status}`) }
      const result: ComplianceResult = await res.json()
      onResult(result)
      go('result')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance analysis failed. Please try again.')
    } finally {
      setRunning(false)
    }
  }

  return <div className="page-content analysis-page">
    <div className="page-heading center-heading"><div><div className="eyebrow"><span className="pulse" /> RULE ENGINE / PROCESSING</div><h1>Running compliance analysis</h1><p>AI extracts. Deterministic rules validate. You decide.</p></div></div>
    <ProgressSteps active={3} />
    <div className="analysis-layout" style={{ display: 'flex', justifyContent: 'center' }}>
      <aside className="panel engine-panel" style={{ marginTop: 20, maxWidth: 560, width: '100%' }}>
        <div className="engine-title"><span className="ai-orb"><BrainCircuit size={20} /></span><div><div className="eyebrow purple-text">AI + RULE ENGINE</div><h3>Explainable compliance</h3></div></div>
        <div className="engine-disclaimer"><Info size={15} /><p>AI identifies declarations. The configured rule engine performs the validation — not a generative model. It also resolves which dated rule version applies to this product before checking it.</p></div>
        {error && <div className="engine-disclaimer" style={{ borderColor: '#ef4444', color: '#ef4444' }}><AlertTriangle size={15} /><p>{error}</p></div>}
        <button className="button primary full" onClick={runAnalysis} disabled={running}>{running ? 'Finalizing analysis...' : 'View compliance result'} <ArrowRight size={16} /></button>
      </aside>
    </div>
  </div>
}

// ---------------------------------------------------------------------------
// RESULT — now also exposes: which dated rule version was applied (and why),
// a PDF export of this exact result, and a disabled "Pass to Risk
// Intelligence" placeholder (per your note, that module comes later).
// ---------------------------------------------------------------------------
function ResultView({ go, result, declaration, inspectionMeta }: {
  go: (v: string) => void
  result: ComplianceResult | null
  declaration: ProductDeclaration
  inspectionMeta: { inspectionId?: string; premisesName?: string; location?: string; inspectionType?: string }
}) {
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  if (!result) {
    return <div className="page-content"><div className="empty-state panel"><h3>No result yet</h3><p>Run a compliance analysis first.</p><button className="button secondary" onClick={() => go('inspection')}>Start an inspection</button></div></div>
  }
  const score = Math.min(100, Math.max(0, result.score))
  const statusTone = result.status === 'COMPLIANT' ? 'green' : result.status === 'NON-COMPLIANT' ? 'red' : 'amber'
  return <div className="page-content">
    <div className="page-heading">
      <div><div className="eyebrow">INSPECTION RESULT</div><h1>Compliance result</h1></div>
      <div className="heading-actions">
        <button className="button primary" onClick={() => go('report')}><FileText size={16} /> Generate report</button>
      </div>
    </div>
    {exportError && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 10 }}>{exportError}</p>}
    {result.appliedRuleVersion && (
      <div className="panel" style={{ padding: 12, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
        <ShieldCheck size={16} />
        <div>
          <strong style={{ display: 'block', fontSize: 13 }}>{result.appliedRuleVersion.label}</strong>
          <small style={{ color: '#64748b' }}>{result.appliedRuleVersion.reason}</small>
        </div>
      </div>
    )}
    <div className="result-overview">
      <section className="panel score-panel"><div className="score-ring"><div><strong>{score}</strong><small>/ 100</small></div></div><div><Badge tone={statusTone}>{result.status}</Badge><p>{result.violations.length === 0 ? 'All mandatory Legal Metrology rules satisfied.' : `${result.violations.length} finding(s) require officer review.`}</p></div></section>
    </div>
    {result.violations.length > 0 && <div className="violation-grid">{result.violations.map((v) => <div className={`violation-card ${v.tag === 'CRITICAL' ? 'red' : 'amber'}`} key={v.title}><Badge tone={v.tag === 'CRITICAL' ? 'red' : 'amber'}>{v.tag}</Badge><h3>{v.title}</h3><p>{v.description}</p></div>)}</div>}
  </div>
}

// A tiny client-side downscale so the stored "thumbnail" stays small — we
// never persist the full-resolution capture, only this preview, since the
// only thing it's used for later is the Inspections card + detail view.
const fileToThumbnailBase64 = (f: File, maxDim = 480, quality = 0.7): Promise<string> =>
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

function ProfileView({ user, jurisdictionCity, jurisdictionState, onPhotoChange }: {
  user: { name?: string | null; role?: string | null; image?: string | null }
  jurisdictionCity?: string | null
  jurisdictionState?: string | null
  onPhotoChange: (image: string | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [photoAction, setPhotoAction] = useState<'uploading' | 'removing' | null>(null)
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
    setPhotoAction('uploading')
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
      setPhotoAction(null)
    }
  }

  const handleRemove = async () => {
    setPhotoAction('removing')
    setError(null)
    try {
      const res = await fetch('/api/profile/photo', { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove photo.')
      onPhotoChange(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove photo.')
    } finally {
      setPhotoAction(null)
    }
  }

  return <div className="page-content narrow">
    <div className="page-heading"><div><div className="eyebrow">ACCOUNT</div><h1>Profile</h1><p>Officer profile details.</p></div></div>
    <section className="panel" style={{ padding: 20, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
      <Avatar name={user.name} image={user.image} size={72} />
      <div>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => handleUpload(e.target.files?.[0] || null)} />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="button secondary" onClick={() => fileRef.current?.click()} disabled={photoAction !== null}>
            {photoAction === 'uploading' ? 'Uploading...' : user.image ? 'Change photo' : 'Upload photo'}
          </button>
          {user.image && <button className="button secondary" onClick={handleRemove} disabled={photoAction !== null}>{photoAction === 'removing' ? 'Removing...' : 'Remove photo'}</button>}
        </div>
        {error && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 6 }}>{error}</p>}
      </div>
    </section>
    <section className="panel" style={{ padding: 20 }}>
      <div className="declaration-field"><label>Name</label><div><input value={user.name || ''} readOnly /></div></div>
      <div className="declaration-field"><label>Role</label><div><input value={ROLE_LABELS[user.role || ''] || 'Officer'} readOnly /></div></div>
      {(jurisdictionCity || jurisdictionState) && (
        <div className="declaration-field">
          <label>Jurisdiction area</label>
          <div><input value={[jurisdictionCity, jurisdictionState].filter(Boolean).join(', ')} readOnly /></div>
        </div>
      )}
    </section>
  </div>
}

function InspectionHistoryView({ onSelect }: { onSelect: (insp: any) => void }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'passed' | 'saved'>('all')

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10000)
    setLoading(true)
    fetch('/api/inspections', { signal: controller.signal })
      .then((res) => { if (!res.ok) throw new Error('Failed to load inspections'); return res.json() })
      .then((data) => { if (!cancelled) setItems(data.inspections || []) })
      .catch((e) => { if (!cancelled) setError(e?.name === 'AbortError' ? 'Loading inspections timed out. Please try again.' : e instanceof Error ? e.message : 'Failed to load inspections') })
      .finally(() => { window.clearTimeout(timeout); if (!cancelled) setLoading(false) })
    return () => { cancelled = true; window.clearTimeout(timeout); controller.abort() }
  }, [])

  const filtered = items.filter((insp) => {
    const name = (insp.declaration?.product_name || 'Unnamed product').toLowerCase()
    if (query && !name.includes(query.toLowerCase())) return false
    if (statusFilter === 'passed' && !insp.passedToSeniorOfficer) return false
    if (statusFilter === 'saved' && insp.passedToSeniorOfficer) return false
    return true
  })

  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow">CASE REPOSITORY</div><h1>Inspections</h1><p>Every case you've saved. Tap one to view the full record.</p></div></div>
    <div className="inspection-toolbar">
      <div className="inspection-search">
        <Search size={15} />
        <input placeholder="Search by product name..." value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="inspection-filter-group">
        <button className={cn('inspection-filter-chip', statusFilter === 'all' && 'active')} onClick={() => setStatusFilter('all')}>All</button>
        <button className={cn('inspection-filter-chip', statusFilter === 'saved' && 'active')} onClick={() => setStatusFilter('saved')}>Saved</button>
        <button className={cn('inspection-filter-chip', statusFilter === 'passed' && 'active')} onClick={() => setStatusFilter('passed')}>Passed</button>
      </div>
    </div>
    {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading inspections...</p>}
    {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}
    {!loading && !error && filtered.length === 0 && <div className="empty-state panel"><h3>No inspections found</h3><p>Try a different search or filter.</p></div>}
    <div className="inspection-row-list">
      {filtered.map((insp) => (
        <div key={insp._id} className="inspection-row">
          <div className="inspection-row-img">
            {insp.capturedImageUrl ? <img src={insp.capturedImageUrl} alt={insp.declaration?.product_name || 'Product'} /> : <Box size={22} />}
          </div>
          <div className="inspection-row-body">
            <strong>{insp.declaration?.product_name || 'Unnamed product'}</strong>
            <small className="inspection-row-status">
              {!insp.passedToSeniorOfficer && 'Saved'}
              {insp.passedToSeniorOfficer && (!insp.reviewStatus || insp.reviewStatus === 'pending') && 'Passed to senior officer • Pending review'}
              {insp.passedToSeniorOfficer && insp.reviewStatus === 'accepted' && <Badge tone="green">Accepted</Badge>}
              {insp.passedToSeniorOfficer && insp.reviewStatus === 'rejected' && (
                <>
                  <Badge tone="red">Rejected</Badge>
                  {insp.rejectionReason && <span style={{ marginLeft: 6, color: '#64748b' }}>{insp.rejectionReason}</span>}
                </>
              )}
            </small>
          </div>
          <div className="inspection-row-action">
            <button className="button secondary" onClick={() => onSelect(insp)}>View details <ChevronRight size={14} /></button>
          </div>
        </div>
      ))}
    </div>
  </div>
}

function InspectionDetailView({ inspectionId, onBack, onGenerateReport, onEdit }: {
  inspectionId: string | null
  onBack: () => void
  onGenerateReport: (insp: any) => void
  onEdit: (insp: any) => void
}) {
  const [insp, setInsp] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!inspectionId) return
    let cancelled = false
    setLoading(true)
    fetch(`/api/inspections/${inspectionId}`)
      .then((res) => { if (!res.ok) throw new Error('Failed to load inspection'); return res.json() })
      .then((data) => { if (!cancelled) setInsp(data.inspection) })
      .catch((e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load inspection') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [inspectionId])

  if (loading) return <div className="page-content"><p style={{ color: '#64748b', fontSize: 12 }}>Loading...</p></div>
  if (error || !insp) return <div className="page-content"><div className="empty-state panel"><h3>Couldn't load this inspection</h3><p>{error}</p><button className="button secondary" onClick={onBack}>Back to inspections</button></div></div>

  const entries = Object.entries(insp.fields || {}) as [string, FieldRecord][]

  return <div className="page-content">
    <div className="page-heading">
      <div><div className="eyebrow">CASE RECORD</div><h1>{insp.declaration?.product_name || 'Inspection record'}</h1><p>{insp.premisesName} • {insp.location?.address}</p></div>
      <div className="heading-actions">
        <button className="button secondary" onClick={onBack}>Back</button>
        <button className="button secondary" onClick={() => onEdit(insp)}><Edit3 size={16} /> Update</button>
        <button className="button primary" onClick={() => onGenerateReport(insp)}><FileText size={16} /> Generate report</button>
      </div>
    </div>
    {insp.capturedImageUrl && (
      <div className="panel" style={{ padding: 12, marginBottom: 16 }}>
        <img src={insp.capturedImageUrl} alt="Captured package" style={{ maxHeight: 320, borderRadius: 8 }} />
      </div>
    )}
    <section className="panel declaration-form">
      <div className="eyebrow">STRUCTURED DECLARATIONS</div>
      <h3>Saved record</h3>
      {entries.map(([name, f]) => (
        <div className="declaration-field" key={name}>
          <label>{FIELD_LABELS[name] || name}<span>{f.status === 'manual' ? 'entered manually' : f.status === 'not_applicable' ? 'not applicable' : f.status === 'missing' ? 'missing' : `${Math.round((f.confidence || 0) * 100)}% confidence`}</span></label>
          <div><input value={f.status === 'not_applicable' ? 'Not applicable' : f.value || ''} readOnly /></div>
        </div>
      ))}
    </section>
    {insp.complianceResult && (
      <div className="panel" style={{ padding: 16, marginTop: 16 }}>
        <strong>Last compliance result: </strong>
        <Badge tone={insp.complianceResult.status === 'COMPLIANT' ? 'green' : insp.complianceResult.status === 'NON-COMPLIANT' ? 'red' : 'amber'}>{insp.complianceResult.status}</Badge>
        <span style={{ marginLeft: 8, color: '#64748b', fontSize: 12 }}>Score {insp.complianceResult.score}/100</span>
      </div>
    )}
    <div style={{ marginTop: 12 }}>
      {!insp.passedToSeniorOfficer && <Badge tone="amber">Not yet passed</Badge>}
      {insp.passedToSeniorOfficer && (!insp.reviewStatus || insp.reviewStatus === 'pending') && <Badge tone="green">Passed to senior officer</Badge>}
      {insp.passedToSeniorOfficer && insp.reviewStatus === 'accepted' && <Badge tone="green">Accepted</Badge>}
      {insp.passedToSeniorOfficer && insp.reviewStatus === 'rejected' && (
        <>
          <Badge tone="red">Rejected</Badge>
          {insp.rejectionReason && (
            <div className="panel" style={{ marginTop: 8, padding: 12, borderLeft: '3px solid #ef4444' }}>
              <strong style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Reason for rejection</strong>
              <span style={{ fontSize: 13, color: '#475569' }}>{insp.rejectionReason}</span>
            </div>
          )}
        </>
      )}
    </div>
  </div>
}

function GuidelineStep({ index, icon: Icon, title, description, tips }: {
  index: number
  icon: React.ElementType
  title: string
  description: string
  tips?: string[]
}) {
  return (
    <div className="panel" style={{ padding: 18, marginBottom: 14, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0, width: 38, height: 38, borderRadius: 10,
        background: 'linear-gradient(135deg, #6366f1, #06b6d4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 700, fontSize: 14, boxShadow: '0 4px 14px rgba(99,102,241,0.35)',
      }}>
        {index}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Icon size={16} />
          <h3 style={{ margin: 0, fontSize: 15 }}>{title}</h3>
        </div>
        <p style={{ margin: 0, color: '#64748b', fontSize: 13, lineHeight: 1.65 }}>{description}</p>
        {tips && tips.length > 0 && (
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 5 }}>
            {tips.map((t, i) => (
              <li key={i} style={{ fontSize: 12, color: '#94a3b8' }}>{t}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function GuidelineTipCard({ icon: Icon, title, desc, tone }: { icon: React.ElementType; title: string; desc: string; tone: 'blue' | 'green' | 'amber' | 'purple' | 'red' }) {
  return (
    <div className="stat-card" style={{ cursor: 'default' }}>
      <div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={17} /></span></div>
      <div className="stat-value" style={{ fontSize: 15 }}>{title}</div>
      <div className="stat-label" style={{ lineHeight: 1.5 }}>{desc}</div>
    </div>
  )
}

function GuidelinesView({ role, go }: { role?: string | null; go: (v: string) => void }) {
  const isExecutive = role === 'executive_officer'

  const executiveSteps = [
    {
      icon: ScanLine, title: 'Start a new inspection',
      description: 'Go to "New Inspection" and fill in the inspection type, premises name, and any field notes. Location is auto-detected via GPS, but you can also type a city/address directly — it resolves automatically as you type.',
      tips: ['Use "Use current location" when standing at the premises for the most accurate record.', 'Notes are part of the permanent audit trail — keep them factual.'],
    },
    {
      icon: Camera, title: 'Capture the package',
      description: 'Take one clear, well-lit photo of the product label using your camera, or upload an existing image. A single good photo is enough — NiyamAI extracts every declaration it can from it.',
      tips: ['Keep the full label flat and in frame — avoid glare and blur.', 'If a calibration marker is detected, enter its real printed size in mm when prompted.'],
    },
    {
      icon: FileWarning, title: 'Resolve missing fields',
      description: 'On the Declaration Extraction screen, review every field NiyamAI read off the label. Anything it couldn\'t confidently extract is flagged — you can recapture just that spot, type the value manually, or mark it not applicable.',
      tips: ['"Not applicable" should only be used when the field genuinely doesn\'t apply to this product.', 'Toggle "This is an imported product" if the label shows a foreign origin.'],
    },
    {
      icon: BrainCircuit, title: 'Run the compliance check',
      description: 'Once every mandatory field is resolved, run the analysis. The deterministic rule engine — not the AI — validates the declarations against the applicable Legal Metrology rule version and returns a score and any violations.',
    },
    {
      icon: FileText, title: 'Save the case & pass it on',
      description: 'From the Report screen, generate a PDF for your records, then click "Save case" to persist it. Once saved, use "Pass to Senior Officer" to send it into the review queue.',
      tips: ['A case must be saved before it can be passed on.', 'You can revisit any saved case from "Inspections" to edit or regenerate its report.'],
    },
  ]

  const seniorSteps = [
    {
      icon: Eye, title: 'Open the Review Queue',
      description: 'Every case an executive officer has passed to you lands here. Use the search bar and the Pending / Accepted / Rejected filters to find what needs your attention.',
    },
    {
      icon: PlayCircle, title: 'View the report',
      description: 'Click "View report" on any case to open the full evidence-backed PDF inline — declarations, compliance score, and every violation found — before making a decision.',
      tips: ['Always review the full report, not just the summary badge, before accepting or rejecting.'],
    },
    {
      icon: Check, title: 'Accept a case',
      description: 'If the evidence and compliance result are satisfactory, click "Accept." This closes the case as reviewed and moves it out of your pending queue.',
    },
    {
      icon: Ban, title: 'Reject a case',
      description: 'If something needs correction, click "Reject" and write a clear reason. This reason is shown directly to the executive officer against that case so they know exactly what to fix.',
      tips: ['Be specific — "blurry label" or "MRP not verified" is more useful than "incomplete."'],
    },
    {
      icon: Layers, title: 'Track outcomes',
      description: 'Switch between the Pending, Accepted, and Rejected tabs any time to see the current state of every case that has passed through you.',
    },
  ]

  const steps = isExecutive ? executiveSteps : seniorSteps

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><BookOpen size={13} /> HOW THIS WORKS</div>
          <h1>Guidelines</h1>
          <p>{isExecutive
            ? 'A quick walkthrough of the inspection workflow, end to end.'
            : 'A quick walkthrough of reviewing cases in your queue.'}</p>
        </div>
        <div className="heading-actions">
          <button className="button primary" onClick={() => go(isExecutive ? 'inspection' : 'review-queue')}>
            {isExecutive ? <ScanLine size={16} /> : <Eye size={16} />}
            {isExecutive ? 'Start inspection' : 'Go to review queue'}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 24 }}>
        {isExecutive ? (
          <>
            <GuidelineTipCard icon={MousePointerClick} tone="blue" title="One photo is enough" desc="A single clear label photo drives the entire extraction pipeline." />
            <GuidelineTipCard icon={ShieldCheck} tone="green" title="You have the final say" desc="AI suggestions are never final — every field can be edited or overridden." />
            <GuidelineTipCard icon={Lightbulb} tone="amber" title="Save before passing on" desc="A case can only be sent to a senior officer after it's saved." />
          </>
        ) : (
          <>
            <GuidelineTipCard icon={Eye} tone="blue" title="Review the full report" desc="Open the PDF before deciding — don't rely on the badge alone." />
            <GuidelineTipCard icon={Ban} tone="red" title="Give a clear reason" desc="Rejection reasons are shown directly to the executive officer." />
            <GuidelineTipCard icon={Lightbulb} tone="amber" title="Filter to stay organized" desc="Use the status tabs to focus on what's still pending." />
          </>
        )}
      </div>

      <section>
        <div className="eyebrow" style={{ marginBottom: 12 }}><Sparkles size={13} /> STEP BY STEP</div>
        {steps.map((s, i) => (
          <GuidelineStep key={s.title} index={i + 1} icon={s.icon} title={s.title} description={s.description} tips={(s as any).tips} />
        ))}
      </section>
    </div>
  )
}

function GenericModule({ view, go }: { view: string; go: (v: string) => void }) {
  const config: Record<string, { eyebrow: string; title: string; desc: string; icon: React.ElementType }> = {
    evidence: { eyebrow: 'SECURE AUDIT', title: 'Evidence vault', desc: 'Cryptographically verified evidence linked to every inspection finding.', icon: Fingerprint },
    product: { eyebrow: 'PRODUCT INTELLIGENCE', title: 'Product intelligence', desc: 'Trace packaging declarations, inspection history and risk over time.', icon: Box },
    manufacturer: { eyebrow: 'ENTITY INTELLIGENCE', title: 'Manufacturer intelligence', desc: 'Identify repeat patterns and prioritize the next inspection target.', icon: UsersRound },
    risk: { eyebrow: 'PREDICTIVE MODEL', title: 'Predictive enforcement intelligence', desc: 'Identify where enforcement resources should be deployed next.', icon: Radar },
    commerce: { eyebrow: 'DIGITAL MARKETPLACE', title: 'Digital marketplace inspector', desc: 'Compare online listings against physical package declarations.', icon: Globe2 },
    rules: { eyebrow: 'RULE MANAGEMENT', title: 'Legal rule intelligence', desc: 'Manage configured validation logic and versioned declaration requirements.', icon: FileCheck2 },
    analytics: { eyebrow: 'ANALYTICS', title: 'Compliance analytics', desc: 'See trends, regional signals and repeat offender distribution.', icon: BarChart3 },
    history: { eyebrow: 'CASE REPOSITORY', title: 'Inspection repository', desc: 'Search, filter and review the complete inspection record.', icon: History },
  }
  const c = config[view] || config.product
  const Icon = c.icon
  return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><Icon size={13} /> {c.eyebrow}</div><h1>{c.title}</h1><p>{c.desc}</p></div><button className="button primary" onClick={() => go('inspection')}><ScanLine size={16} /> Start inspection</button></div>
    {view === 'history' || view === 'manufacturer' ? <section className="panel feed-panel"><InspectionTable rows={inspections} go={go} /></section> : <div className="empty-state panel"><div className="empty-icon"><Icon size={25} /></div><h3>Intelligence module ready</h3><p>Connect this prototype surface to live data when ready.</p><button className="button secondary" onClick={() => go('overview')}>Back to command center</button></div>}
  </div>
}

// ReportView now also wires "Generate PDF" to the same export handler as
// ResultView (passed down as a prop), so the officer can export from either
// screen without duplicating the fetch/download logic.
function ReportView({ go, onSave, saving, isSaved, onExportPdf, exporting, saveError, role, isPassed, onPass, passing, passError, readability, complianceResult }: {
  go: (v: string) => void
  onSave: () => void
  saving: boolean
  isSaved: boolean
  onExportPdf: () => void
  exporting: boolean
  saveError: string | null
  role?: string | null
  isPassed: boolean
  onPass: () => void
  passing: boolean
  passError: string | null
  readability?: any
  complianceResult?: ComplianceResult | null
}) {
  const overall = readability?.overall_readability
  return <div className="page-content">
    <div className="page-heading">
      <div><div className="eyebrow">CASE CLOSURE</div><h1>Generate inspection report</h1><p>Evidence-based report preview ready for officer review.</p></div>
      <div className="heading-actions">
        <button className="button secondary" onClick={onExportPdf} disabled={exporting}><Download size={16} /> {exporting ? 'Generating...' : 'Generate PDF'}</button>
        <button className="button primary" onClick={onSave} disabled={saving || isSaved}><ShieldCheck size={16} /> {saving ? 'Saving...' : isSaved ? 'Case saved' : 'Save case'}</button>
        {role === 'executive_officer' && (
          <button className="button secondary" onClick={onPass} disabled={!isSaved || passing || isPassed}>
            <ArrowRight size={16} /> {passing ? 'Passing...' : isPassed ? 'Passed to Senior Officer' : 'Pass to Senior Officer'}
          </button>
        )}
      </div>
    </div>
    {overall && (
      <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
        <div className="eyebrow">PHOTO READABILITY</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Badge tone={overall.human_readable ? 'green' : 'amber'}>{overall.grade}</Badge>
          <span style={{ fontSize: 12, color: '#64748b' }}>Score {overall.score}/100</span>
          {overall.major_issue && <span style={{ fontSize: 12, color: '#64748b' }}>• {overall.major_issue}</span>}
        </div>
        {overall.retake_required && <p style={{ color: '#f59e0b', fontSize: 11, marginTop: 6 }}>Retake recommended for stronger evidence.</p>}
      </div>
    )}
    {saveError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{saveError}</p>}
    {passError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{passError}</p>}
  </div>
}

export default function NiyamAIApp({ initialView = 'overview' }: { initialView?: string }) {
  const { data: session, update } = useSession()  
  const [profileImage, setProfileImage] = useState<string | null>(null)
  const sessionEmail = session?.user?.email
  useEffect(() => {
    if (!sessionEmail) {
      setProfileImage(null)
      return
    }
    setProfileImage(session?.user?.image || null)
    fetch('/api/profile/photo')
      .then((res) => res.ok ? res.json() : null)
      .then((data) => { if (data) setProfileImage(data.image || null) })
      .catch(() => {})
    const ping = () => { fetch('/api/heartbeat', { method: 'POST' }).catch(() => {}) }
    ping()
    const interval = setInterval(ping, 60_000)
    return () => clearInterval(interval)
  }, [sessionEmail])
  const user = { name: session?.user?.name, image: profileImage, role: (session?.user as any)?.role, jurisdictionCity: (session?.user as any)?.jurisdictionCity, jurisdictionState: (session?.user as any)?.jurisdictionState, }
  const [active, setActive] = useState(initialView)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [mongoInspectionId, setMongoInspectionId] = useState<string | null>(null)
  const [capturedImageBase64, setCapturedImageBase64] = useState<string | null>(null)
  const [isPassedToSenior, setIsPassedToSenior] = useState(false)
  const [passingToSenior, setPassingToSenior] = useState(false)
  const [passError, setPassError] = useState<string | null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const handlePhotoChange = async (image: string | null) => {
    setProfileImage(image)
    await update({ image })
  }

  // Nothing is written to Mongo until handleSaveCase runs at the end.
  // `inspectionDraft` holds the form details from InspectionView in memory.
  // `inspectionId` is a temporary client-side id (not a Mongo _id / inspectionId)
  // used only to tag the OCR microservice calls during capture/extraction.
  const [inspectionDraft, setInspectionDraft] = useState<InspectionDraft | null>(null)
  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, FieldRecord>>({})
  const [isImported, setIsImported] = useState(false)
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null)
  const [savingCase, setSavingCase] = useState(false)
  const [isCaseSaved, setIsCaseSaved] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)

  const MANDATORY_FIELD_KEYS = ['product_name', 'company_name', 'net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care', 'font_height_mm', 'principal_display_panel_area_cm2']

  const handleExtracted = (raw: Record<string, FieldRecord>) => {
    const withDefaults = { ...raw }
    for (const key of MANDATORY_FIELD_KEYS) {
      if (!withDefaults[key]) {
        withDefaults[key] = {
          value: null,
          confidence: 0,
          status: 'missing',
          reason: key === 'font_height_mm' ? 'ArUco cannot be detected — enter font size manually' : 'Not returned by extraction service',
        }
      }
    }
    setFields(withDefaults)
  }

  const go = (v: string) => { setActive(v); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // Normalizes common OCR unit spellings ("gm", "gms", "ltr"...) onto the
  // canonical units the rule engine's VALID_UNITS list actually recognises.
  const normalizeUnit = (raw: string) => {
    const map: Record<string, string> = {
      gm: 'g', gms: 'g', gram: 'g', grams: 'g',
      kg: 'kg', kgs: 'kg',
      ml: 'ml',
      l: 'l', ltr: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
    }
    return map[raw.toLowerCase()] || raw.toLowerCase()
  }

  const parseNum = (v?: string | number | null): number | undefined => {
    if (v === null || v === undefined || v === '') return undefined
    const s = typeof v === 'number' ? String(v) : String(v)
    const match = s.match(/\d+(\.\d+)?/)
    const n = match ? Number(match[0]) : NaN
    return Number.isFinite(n) && n > 0 ? n : undefined
  }

  // Builds the ProductDeclaration shape the rule engine expects out of
  // whatever's currently resolved in `fields` (extracted or manual).
  //
  // IMPORTANT FIX: previously this hardcoded `product_name` to 'Unknown
  // product' and font_height_mm/principal_display_panel_area_cm2 to `0`.
  // That silently made the mandatory-presence check always pass even when
  // the product name was genuinely missing, and made the font-height check
  // always fail (0mm is always < the minimum). Missing values are now left
  // `undefined` so the rule engine treats them as actually missing/unknown,
  // exactly like the ExtractionView "missing field" resolver already does
  // for every other declaration.
  const netQtyRaw = fields.net_quantity?.value || ''
  const unitMatch = /([a-zA-Z]+)\s*$/.exec(netQtyRaw.trim())
  const [saveError, setSaveError] = useState<string | null>(null)

  const declaration: ProductDeclaration = {
    product_name: fields.product_name?.value || undefined,
    company_name: fields.company_name?.value || undefined,
    mrp_tax_inclusive: fields.mrp_tax_inclusive?.value || undefined,
    net_quantity: {
      value: parseNum(netQtyRaw) || 0,
      unit: normalizeUnit(unitMatch?.[1] || 'g'),
      font_height_mm: parseNum(fields.font_height_mm?.value),
      principal_display_panel_area_cm2: parseNum(fields.principal_display_panel_area_cm2?.value),
    },
    mrp: { amount: parseNum(fields.mrp?.value) || 0, currency: '₹' },
    manufacturer: [fields.manufacturer?.value, fields.manufacturer_address?.value]
      .filter((value, index, values) => value && values.indexOf(value) === index)
      .join(', ') || undefined,
    packed_date: fields.manufacturing_date?.value || undefined,
    consumer_care: fields.consumer_care?.value || undefined,
    country_of_origin: fields.country_of_origin?.value || undefined,
    is_imported: isImported,
  }

  const inspectionMeta = {
    inspectionId: inspectionId || undefined,
    premisesName: inspectionDraft?.premisesName,
    location: inspectionDraft?.location?.address,
    inspectionType: inspectionDraft?.inspectionType,
  }

  // Shared PDF export handler — used by both ResultView and ReportView so
  // there's exactly one place that talks to /api/report/pdf.
  const exportPdf = async () => {
    if (!complianceResult) return
    setExportingPdf(true)
    try {
        const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inspectionMeta, declaration, result: complianceResult, readability }),
      })
      if (!res.ok) throw new Error('PDF export failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `inspection-${inspectionMeta.inspectionId || 'report'}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error(e)
    } finally {
      setExportingPdf(false)
    }
  }

  const handleLogout = async () => { setLoggingOut(true); await signOut({ callbackUrl: '/login', redirect: true }) }

  // The single point where the inspection actually gets persisted — only
  // once the officer has been through inspection details, capture,
  // extraction, analysis and result, and explicitly clicks "Save case".
  // Now also sends the resolved `declaration` snapshot alongside `fields`,
  // so history/PDF re-export later doesn't have to re-derive it.
    const handleSaveCase = async () => {
    if (!inspectionDraft || isCaseSaved) return
    setSavingCase(true)
    setSaveError(null)
    try {
      const endpoint = mongoInspectionId ? `/api/inspections/${mongoInspectionId}` : '/api/inspections'
      const method = mongoInspectionId ? 'PATCH' : 'POST'
      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inspectionDraft, fields, declaration, complianceResult, capturedImageUrl: capturedImageBase64, readability }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Save failed with status ${res.status}`)
      }
      const saved = await res.json().catch(() => null)
      if (saved?.inspection?._id) setMongoInspectionId(saved.inspection._id)
      setIsCaseSaved(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save inspection.')
    } finally {
      setSavingCase(false)
    }
  }

  const handlePassToSenior = async () => {
    if (!mongoInspectionId || !isCaseSaved || isPassedToSenior) return
    setPassingToSenior(true)
    setPassError(null)
    try {
      const res = await fetch(`/api/inspections/${mongoInspectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passedToSeniorOfficer: true }),
      })
      if (!res.ok) throw new Error('Failed to pass to senior officer.')
      setIsPassedToSenior(true)
    } catch (e) {
      setPassError(e instanceof Error ? e.message : 'Failed to pass to senior officer.')
    } finally {
      setPassingToSenior(false)
    }
  }

  const handleLoadForEdit = (insp: any) => {
    setMongoInspectionId(null)
    setFields(insp.fields || {})
    setIsImported(!!insp.declaration?.is_imported)
    setInspectionDraft({ inspectionType: insp.inspectionType || 'Physical store', premisesName: insp.premisesName || '', notes: insp.notes || '', location: insp.location || { address: '' } })
    setInspectionId(crypto.randomUUID())
    setCapturedImageBase64(insp.capturedImageUrl || null)
    setReadability(insp.readability || null)
    setComplianceResult(null)
    setIsCaseSaved(false)
    setIsPassedToSenior(false)
    go('extraction')
  }

  const handleLoadForReport = (insp: any) => {
    setMongoInspectionId(insp._id)
    setFields(insp.fields || {})
    setIsImported(!!insp.declaration?.is_imported)
    setComplianceResult(insp.complianceResult || null)
    setInspectionDraft({ inspectionType: insp.inspectionType || 'Physical store', premisesName: insp.premisesName || '', notes: insp.notes || '', location: insp.location || { address: '' } })
    setInspectionId(insp.inspectionId || crypto.randomUUID())
    setCapturedImageBase64(insp.capturedImageUrl || null)
    setReadability(insp.readability || null)
    setIsCaseSaved(true)
    setIsPassedToSenior(!!insp.passedToSeniorOfficer)
    go('report')
  }
  const [readability, setReadability] = useState<any | null>(null)
  let view: React.ReactNode
  if (active === 'overview') view = <Dashboard go={go} role={user.role} />   // MODIFIED
  else if (active === 'inspection') view = <InspectionView go={go} onCreated={(draft) => {
    setInspectionDraft(draft)
    setInspectionId(crypto.randomUUID())
    setIsCaseSaved(false)
    setMongoInspectionId(null)
    setCapturedImageBase64(null)
    setIsPassedToSenior(false)
    setComplianceResult(null)
    setReadability(null)
    setFields({})
  }} />
  else if (active === 'capture') view = <CaptureView go={go} inspectionId={inspectionId} onExtracted={handleExtracted} onImageCaptured={setCapturedImageBase64} onReadability={setReadability} />
  else if (active === 'extraction') view = <ExtractionView go={go} inspectionId={inspectionId} fields={fields} setFields={setFields} isImported={isImported} setIsImported={setIsImported} />
  else if (active === 'analysis') view = <AnalysisView go={go} declaration={declaration} onResult={(result) => { setComplianceResult(result); setIsCaseSaved(false); setIsPassedToSenior(false) }} />
  else if (active === 'result') view = <ResultView go={go} result={complianceResult} declaration={declaration} inspectionMeta={inspectionMeta} />
  else if (active === 'report') view = <ReportView go={go} onSave={handleSaveCase} saving={savingCase} isSaved={isCaseSaved} onExportPdf={exportPdf} exporting={exportingPdf} saveError={saveError} role={user.role} isPassed={isPassedToSenior} onPass={handlePassToSenior} passing={passingToSenior} passError={passError} readability={readability} complianceResult={complianceResult} />
  else if (active === 'profile') view = (
    <ProfileView
      user={user}
      jurisdictionCity={user.jurisdictionCity}
      jurisdictionState={user.jurisdictionState}
      onPhotoChange={handlePhotoChange}
    />
  )
  else if (active === 'history') view = <InspectionHistoryView onSelect={(insp) => { setSelectedInspectionId(insp._id); go('inspection-detail') }} />
  else if (active === 'review-queue') view = <SeniorReviewView />
  else if (active === 'guidelines') view = <GuidelinesView role={user.role} go={go} />
  else if (active === 'enforcement-map') view = <EnforcementMapView />
  else if (active === 'admin-users') view = <UsersView />
  else if (active === 'inspection-detail') view = <InspectionDetailView inspectionId={selectedInspectionId} onBack={() => go('history')} onGenerateReport={handleLoadForReport} onEdit={handleLoadForEdit} />
  else if (active === 'analytics') view = <AnalyticsView />
  else view = <GenericModule view={active} go={go} />

  const mobileNavItems = (user.role === 'executive_officer'
    ? [['overview', LayoutDashboard, 'Home'], ['inspection', ScanLine, 'Inspect'], ['history', History, 'History'], ['profile', UserRound, 'Profile']]
    : user.role === 'senior_officer'
    ? [['overview', LayoutDashboard, 'Home'], ['review-queue', Eye, 'Review'], ['profile', UserRound, 'Profile']]
    : [['overview', LayoutDashboard, 'Home'], ['enforcement-map', Radar, 'Map'], ['admin-users', UsersRound, 'Users'], ['analytics', BarChart3, 'Analytics'], ['profile', UserRound, 'Profile']]
  ) as [string, React.ElementType, string][]

  return (
    <div className="app-shell">
      <Sidebar active={active} setActive={go} collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      <div className={cn('main-shell', mobileOpen && 'mobile-open')}>
        <Topbar onMenu={() => setMobileOpen(true)} onLogout={() => setShowLogoutModal(true)} user={user} go={go} /> 
        <main>{view}</main>
        <div className="mobile-nav">
          {mobileNavItems.map(([v, Icon, label]) => (
            <button className={active === v ? 'active' : ''} key={v} onClick={() => go(v)}><Icon size={19} /><span>{label}</span></button>
          ))}
        </div>
      </div>
      {mobileOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
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

export { NiyamAIApp }
