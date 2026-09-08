'use client'

import { useState, useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from 'next-auth/react'
import type { ProductDeclaration, ComplianceResult } from '@/lib/rules/types'
import { signOut } from 'next-auth/react'
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Bell, Box, BrainCircuit, Camera, Check,
  ChevronRight, ClipboardCheck, Clock3, CloudOff, Download, Eye, FileCheck2, FileText,
  Fingerprint, Globe2, Hash, History, Info, LayoutDashboard, Menu, MapPin, Maximize2,
  PackageCheck, PanelLeftClose, PanelLeftOpen, Radar, Search, ScanLine, Sun, Moon,
  Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Target, Upload, UserRound,
  UsersRound, X, Zap, LogOut, Edit3, RefreshCw, Ban,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Field metadata: how each declaration key from the microservice maps onto
// a human label + which YOLO/field-class name the recapture endpoint expects.
// ---------------------------------------------------------------------------
const FIELD_LABELS: Record<string, string> = {
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
}

// Shape of the details collected on the Inspection screen, held in memory
// only, until the officer finishes the whole flow and saves the case.
export type InspectionDraft = {
  inspectionType: string
  premisesName: string
  notes: string
  location: { address: string; lat?: number; lng?: number }
}

const nav = [
  { label: 'Overview', icon: LayoutDashboard, view: 'overview', section: 'COMMAND' },
  { label: 'New Inspection', icon: ScanLine, view: 'inspection', section: 'OPERATIONS', accent: true },
  { label: 'Product Scanner', icon: Camera, view: 'capture', section: 'OPERATIONS' },
  { label: 'Inspections', icon: ClipboardCheck, view: 'history', section: 'OPERATIONS' },
  { label: 'Products', icon: Box, view: 'product', section: 'INTELLIGENCE' },
  { label: 'Manufacturers', icon: UsersRound, view: 'manufacturer', section: 'INTELLIGENCE' },
  { label: 'Risk Intelligence', icon: Radar, view: 'risk', section: 'INTELLIGENCE' },
  { label: 'E-Commerce Monitor', icon: Globe2, view: 'commerce', section: 'INTELLIGENCE' },
  { label: 'Evidence Vault', icon: Fingerprint, view: 'evidence', section: 'AUDIT' },
  { label: 'Rule Intelligence', icon: FileCheck2, view: 'rules', section: 'AUDIT' },
  { label: 'Analytics', icon: BarChart3, view: 'analytics', section: 'AUDIT' },
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

function Topbar({ onMenu, onLogout, user }: { onMenu: () => void; onLogout: () => void; user: { name?: string | null; image?: string | null; role?: string | null } }) {
  return <header className="topbar">
    <button className="mobile-menu icon-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
    <div className="search-box"><Search size={17} /><input placeholder="Search inspections, products, evidence..." /><kbd>⌘ K</kbd></div>
    <div className="top-actions"><div className="location"><MapPin size={15} /><span>Kolkata, WB</span><ChevronRight size={13} /></div><div className="service-status"><i /> All systems operational</div><ThemeToggle /><button className="icon-button notification"><Bell size={18} /><b>3</b></button></div>
    <div className="officer" onClick={onLogout} style={{ cursor: 'pointer' }} title="Click to sign out">
      <Avatar name={user.name} image={user.image} size={36} />
      <div><strong>{user.name || 'Officer'}</strong><small>{ROLE_LABELS[user.role || ''] || 'Officer'}</small></div>
      <LogOut size={15} style={{ marginLeft: '6px', color: '#64748b' }} />
    </div>
  </header>
}

function Sidebar({ active, setActive, collapsed, setCollapsed, user }: { active: string; setActive: (v: string) => void; collapsed: boolean; setCollapsed: (v: boolean) => void; user: { name?: string | null; image?: string | null; role?: string | null } }) {
  let current = ''
  return <aside className={cn('sidebar', collapsed && 'collapsed')}>
    <div className="sidebar-head"><Logo /><button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    <div className="workspace"><span className="workspace-dot" /><div><strong>AI Compliance</strong><small>INTELLIGENCE PLATFORM</small></div></div>
    <nav>{nav.map((item) => { const show = current !== item.section; current = item.section; return <div key={item.view}>{show && !collapsed && <div className="nav-section">{item.section}</div>}<button title={item.label} className={cn('nav-item', active === item.view && 'active', item.accent && 'accent')} onClick={() => setActive(item.view)}><item.icon size={17} /><span>{item.label}</span>{item.accent && <span className="live-dot" />}</button></div> })}</nav>
    <div className="sidebar-bottom"><button className="nav-item" title="Notifications"><Bell size={17} /><span>Notifications</span><em>3</em></button><button className="nav-item" title="Help & Documentation"><Info size={17} /><span>Help & Documentation</span></button>
      <div className="sidebar-profile"><Avatar name={user.name} image={user.image} size={32} /><div><strong>{user.name || 'Officer'}</strong><small>{ROLE_LABELS[user.role || ''] || 'Officer'}</small></div><Settings2 size={16} /></div>
    </div>
  </aside>
}

function Dashboard({ go }: { go: (view: string) => void }) {
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS</div><h1>Enforcement Command Center</h1><p>Real-time compliance intelligence across inspections, products and manufacturers.</p></div><div className="heading-actions"><button className="button secondary"><Download size={16} /> Export brief</button><button className="button primary" onClick={() => go('inspection')}><ScanLine size={16} /> Start inspection <ArrowRight size={16} /></button></div></div>
    <div className="stats-grid"><StatCard icon={ClipboardCheck} label="Total inspections" value="12,540" change="↗ 14.8%" tone="blue" data={[32,45,38,62,52,76,68,82,74,92,88,100]} /><StatCard icon={AlertTriangle} label="Non-compliant" value="4,310" change="34.4%" tone="red" data={[70,64,78,61,68,54,58,48,52,42,46,38]} /><StatCard icon={Target} label="High-risk products" value="827" change="↗ 9.2%" tone="amber" data={[35,42,37,58,49,62,68,65,78,72,84,90]} /><StatCard icon={History} label="Repeat violations" value="312" change="↗ 6.7%" tone="purple" data={[30,26,44,35,52,48,60,57,70,64,78,76]} /><StatCard icon={BrainCircuit} label="AI detection confidence" value="94.6%" change="+2.1%" tone="green" data={[72,76,74,82,80,84,86,88,87,92,90,95]} /></div>
    <section className="panel feed-panel"><div className="panel-head"><div><div className="eyebrow"><Activity size={13} /> LIVE FEED</div><h3>Recent inspections</h3></div><button className="text-button" onClick={() => go('history')}>Open repository <ArrowRight size={14} /></button></div><InspectionTable rows={inspections} go={go} /></section>
  </div>
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

  useEffect(() => {
    if (!navigator.geolocation) { setAddress('Location unavailable'); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setAddress(`${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`)
      },
      () => setAddress('Location permission denied — enter manually'),
    )
  }, [])

  const handleContinue = () => {
    onCreated({ inspectionType, premisesName, notes, location: { address, ...coords } })
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
          <label className="wide">Location<div className="input-with-action"><input value={address} onChange={(e) => setAddress(e.target.value)} /><button type="button" className="inline-action" onClick={() => window.location.reload()}><MapPin size={15} /> Re-detect</button></div></label>
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
function CaptureView({ go, inspectionId, onExtracted }: { go: (v: string) => void; inspectionId: string | null; onExtracted: (fields: Record<string, FieldRecord>) => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment')
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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
      const form = new FormData()
      form.append('inspectionId', inspectionId)
      form.append('image', file)
      const res = await fetch('/api/microservice/extract', { method: 'POST', body: form })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'Extraction failed')
      const { structuredData } = await res.json()
      onExtracted(structuredData)
      go('extraction')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Extraction failed. Please retry.')
    } finally {
      setUploading(false)
    }
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

  const exportPdf = async () => {
    if (!result) return
    setExporting(true)
    setExportError(null)
    try {
      const res = await fetch('/api/report/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inspectionMeta, declaration, result }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || 'PDF export failed')
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
      setExportError(e instanceof Error ? e.message : 'PDF export failed.')
    } finally {
      setExporting(false)
    }
  }

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
function ReportView({ go, onSave, saving, isSaved, onExportPdf, exporting, saveError }: {
  go: (v: string) => void
  onSave: () => void
  saving: boolean
  isSaved: boolean
  onExportPdf: () => void
  exporting: boolean
  saveError: string | null
}) {
  return <div className="page-content">
    <div className="page-heading">
      <div><div className="eyebrow">CASE CLOSURE</div><h1>Generate inspection report</h1><p>Evidence-based report preview ready for officer review.</p></div>
      <div className="heading-actions">
        <button className="button secondary" onClick={onExportPdf} disabled={exporting}><Download size={16} /> {exporting ? 'Generating...' : 'Generate PDF'}</button>
        <button className="button primary" onClick={onSave} disabled={saving || isSaved}><ShieldCheck size={16} /> {saving ? 'Saving...' : isSaved ? 'Case saved' : 'Save case'}</button>
      </div>
    </div>
    {saveError && <p style={{ color: '#ef4444', fontSize: 12, marginTop: 10 }}>{saveError}</p>}
  </div>
}

export default function NiyamAIApp({ initialView = 'overview' }: { initialView?: string }) {
  const { data: session } = useSession()
  const user = { name: session?.user?.name, image: session?.user?.image, role: (session?.user as any)?.role }
  const [active, setActive] = useState(initialView)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

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

  const MANDATORY_FIELD_KEYS = ['product_name', 'company_name', 'net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care']

  const handleExtracted = (raw: Record<string, FieldRecord>) => {
    const withDefaults = { ...raw }
    for (const key of MANDATORY_FIELD_KEYS) {
      if (!withDefaults[key]) {
        withDefaults[key] = { value: null, confidence: 0, status: 'missing', reason: 'Not returned by extraction service' }
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
    net_quantity: {
      value: parseNum(netQtyRaw) || 0,
      unit: normalizeUnit(unitMatch?.[1] || 'g'),
      font_height_mm: parseNum(fields.font_height_mm?.value),
      principal_display_panel_area_cm2: parseNum(fields.principal_display_panel_area_cm2?.value),
    },
    mrp: { amount: parseNum(fields.mrp?.value) || 0, currency: '₹' },
    manufacturer: fields.manufacturer?.value || undefined,
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
        body: JSON.stringify({ ...inspectionMeta, declaration, result: complianceResult }),
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
      const res = await fetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...inspectionDraft, fields, declaration, complianceResult }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error || `Save failed with status ${res.status}`)
      }
      setIsCaseSaved(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save inspection.')
    } finally {
      setSavingCase(false)
    }
  }

  let view: React.ReactNode
  if (active === 'overview') view = <Dashboard go={go} />
  else if (active === 'inspection') view = <InspectionView go={go} onCreated={(draft) => { setInspectionDraft(draft); setInspectionId(crypto.randomUUID()); setIsCaseSaved(false) }} />
  else if (active === 'capture') view = <CaptureView go={go} inspectionId={inspectionId} onExtracted={handleExtracted} />
  else if (active === 'extraction') view = <ExtractionView go={go} inspectionId={inspectionId} fields={fields} setFields={setFields} isImported={isImported} setIsImported={setIsImported} />
  else if (active === 'analysis') view = <AnalysisView go={go} declaration={declaration} onResult={setComplianceResult} />
  else if (active === 'result') view = <ResultView go={go} result={complianceResult} declaration={declaration} inspectionMeta={inspectionMeta} />
  else if (active === 'report') view = <ReportView go={go} onSave={handleSaveCase} saving={savingCase} isSaved={isCaseSaved} onExportPdf={exportPdf} exporting={exportingPdf} saveError={saveError} />
  else view = <GenericModule view={active} go={go} />

  return (
    <div className="app-shell">
      <Sidebar active={active} setActive={go} collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      <div className={cn('main-shell', mobileOpen && 'mobile-open')}>
        <Topbar onMenu={() => setMobileOpen(true)} onLogout={() => setShowLogoutModal(true)} user={user} />
        <main>{view}</main>
        <div className="mobile-nav">
          {([['overview', LayoutDashboard, 'Home'], ['inspection', ScanLine, 'Inspect'], ['history', History, 'History'], ['evidence', Fingerprint, 'Evidence'], ['profile', UserRound, 'Profile']] as [string, React.ElementType, string][]).map(([v, Icon, label]) => (
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
