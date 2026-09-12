'use client'

import { useState, useEffect } from 'react'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, UserRound, LogOut, ScanLine, Menu, PanelLeftClose, PanelLeftOpen,
  ClipboardCheck, History,
} from 'lucide-react'
import { SimpleProfileView } from '../shared/ProfileView'
import {
  Dashboard, InspectionView, CaptureView, ExtractionView, AnalysisView,
  ResultView, ReportView, InspectionHistoryView, InspectionDetailView,
  Avatar, ThemeToggle,
} from '../../niyam-ai-app'
import type { ProductDeclaration, ComplianceResult } from '@/lib/rules/types'
import type { FieldRecord, InspectionDraft } from '../../niyam-ai-app'

function cn(...c: (string | false | null | undefined)[]) { return c.filter(Boolean).join(' ') }

function Logo() {
  return <div className="brand-mark"><ScanLine size={20} strokeWidth={2.5} /><span>Niyam<span>AI</span></span></div>
}

const NAV = [
  { label: 'Dashboard', icon: LayoutDashboard, view: 'overview' },
  { label: 'New Inspection', icon: ScanLine, view: 'inspection', accent: true },
  { label: 'Inspections', icon: ClipboardCheck, view: 'history' },
  { label: 'Profile', icon: UserRound, view: 'profile' },
]

export function ProductManagerApp() {
  const { data: session, update } = useSession()
  const [active, setActive] = useState('overview')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [profileImage, setProfileImage] = useState<string | null>(null)

  const sessionEmail = session?.user?.email

  useEffect(() => {
    if (!sessionEmail) { setProfileImage(null); return }
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

  const user = {
    name: session?.user?.name,
    image: profileImage,
    companyName: (session?.user as any)?.companyName,
    productName: (session?.user as any)?.productName,
  }

  const handlePhotoChange = async (image: string | null) => {
    setProfileImage(image)
    await update({ image })
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    await signOut({ callbackUrl: '/login', redirect: true })
  }

  const go = (v: string) => { setActive(v); setMobileOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  // ---- same in-memory inspection workflow state as NiyamAIApp, minus pass-to-senior ----
  const [mongoInspectionId, setMongoInspectionId] = useState<string | null>(null)
  const [capturedImageBase64, setCapturedImageBase64] = useState<string | null>(null)
  const [selectedInspectionId, setSelectedInspectionId] = useState<string | null>(null)
  const [inspectionDraft, setInspectionDraft] = useState<InspectionDraft | null>(null)
  const [inspectionId, setInspectionId] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, FieldRecord>>({})
  const [isImported, setIsImported] = useState(false)
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null)
  const [savingCase, setSavingCase] = useState(false)
  const [isCaseSaved, setIsCaseSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [readability, setReadability] = useState<any | null>(null)

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

  const netQtyRaw = fields.net_quantity?.value || ''
  const unitMatch = /([a-zA-Z]+)\s*$/.exec(netQtyRaw.trim())

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

  // Product managers save and can update — no pass-to-senior step at all.
  const handleSaveCase = async () => {
    if (!inspectionDraft) return
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

  const handleLoadForEdit = (insp: any) => {
    setMongoInspectionId(insp._id)
    setFields(insp.fields || {})
    setIsImported(!!insp.declaration?.is_imported)
    setInspectionDraft({ inspectionType: insp.inspectionType || 'Physical store', premisesName: insp.premisesName || '', notes: insp.notes || '', location: insp.location || { address: '' } })
    setInspectionId(crypto.randomUUID())
    setCapturedImageBase64(insp.capturedImageUrl || null)
    setReadability(insp.readability || null)
    setComplianceResult(insp.complianceResult || null)
    setIsCaseSaved(true)
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
    go('report')
  }

  let view: React.ReactNode
  if (active === 'overview') {
    // Reuses the executive_officer shape of the dashboard (own totals + recent list),
    // which is exactly what a product manager needs — just their own case activity.
    view = <Dashboard go={go} role="executive_officer" />
  } else if (active === 'inspection') {
    view = <InspectionView go={go} onCreated={(draft) => {
      setInspectionDraft(draft)
      setInspectionId(crypto.randomUUID())
      setIsCaseSaved(false)
      setMongoInspectionId(null)
      setCapturedImageBase64(null)
      setComplianceResult(null)
      setReadability(null)
      setFields({})
    }} />
  } else if (active === 'capture') {
    view = <CaptureView go={go} inspectionId={inspectionId} onExtracted={handleExtracted} onImageCaptured={setCapturedImageBase64} onReadability={setReadability} />
  } else if (active === 'extraction') {
    view = <ExtractionView go={go} inspectionId={inspectionId} fields={fields} setFields={setFields} isImported={isImported} setIsImported={setIsImported} />
  } else if (active === 'analysis') {
    view = <AnalysisView go={go} declaration={declaration} onResult={(result) => { setComplianceResult(result); setIsCaseSaved(false) }} />
  } else if (active === 'result') {
    view = <ResultView go={go} result={complianceResult} declaration={declaration} inspectionMeta={inspectionMeta} />
  } else if (active === 'report') {
    view = (
      <ReportView
        go={go}
        onSave={handleSaveCase}
        saving={savingCase}
        isSaved={isCaseSaved}
        onExportPdf={exportPdf}
        exporting={exportingPdf}
        saveError={saveError}
        role="product_manager" // not 'executive_officer', so the "Pass to Senior Officer" button never renders
        isPassed={false}
        onPass={() => {}}
        passing={false}
        passError={null}
        readability={readability}
        complianceResult={complianceResult}
      />
    )
  } else if (active === 'history') {
    view = <InspectionHistoryView onSelect={(insp) => { setSelectedInspectionId(insp._id); go('inspection-detail') }} />
  } else if (active === 'inspection-detail') {
    view = <InspectionDetailView inspectionId={selectedInspectionId} onBack={() => go('history')} onGenerateReport={handleLoadForReport} onEdit={handleLoadForEdit} />
  } else {
    view = (
      <SimpleProfileView
        user={user}
        roleLabel="Product Manager"
        extraFields={[
          { label: 'Company', value: user.companyName || '—' },
          { label: 'Product', value: user.productName || '—' },
        ]}
        onPhotoChange={handlePhotoChange}
      />
    )
  }

  const mobileNavItems: [string, React.ElementType, string][] = [
    ['overview', LayoutDashboard, 'Home'],
    ['inspection', ScanLine, 'Inspect'],
    ['history', History, 'History'],
    ['profile', UserRound, 'Profile'],
  ]

  return (
    <div className="app-shell">
      <aside className={cn('sidebar', collapsed && 'collapsed')}>
        <div className="sidebar-head"><Logo /><button className="collapse-button" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
        <div className="workspace"><span className="workspace-dot" /><div><strong>{user.productName || 'Product'}</strong><small>{user.companyName || 'COMPANY'}</small></div></div>
        <nav>
          <div className="nav-section">MAIN</div>
          {NAV.map((item) => (
            <button key={item.view} title={item.label} className={cn('nav-item', active === item.view && 'active', (item as any).accent && 'accent')} onClick={() => go(item.view)}>
              <item.icon size={17} /><span>{item.label}</span>
              {(item as any).accent && <span className="live-dot" />}
            </button>
          ))}
        </nav>
      </aside>
      <div className={cn('main-shell', mobileOpen && 'mobile-open')}>
        <header className="topbar">
          <button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <div className="top-actions">
            <div className="service-status"><i /> All systems operational</div>
            <ThemeToggle />
          </div>
          <div className="officer" style={{ cursor: 'pointer' }}>
            <div onClick={() => go('profile')} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }} title="Go to profile">
              <Avatar name={user.name} image={user.image} size={36} />
              <div><strong>{user.name || 'Manager'}</strong><small>Product Manager</small></div>
            </div>
            <span onClick={() => setShowLogoutModal(true)} title="Sign out" style={{ display: 'inline-flex', marginLeft: 6, cursor: 'pointer' }}><LogOut size={15} color="#64748b" /></span>
          </div>
        </header>
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