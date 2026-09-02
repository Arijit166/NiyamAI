'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { signOut } from 'next-auth/react'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  Box,
  BrainCircuit,
  Camera,
  Check,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  CloudOff,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Fingerprint,
  Globe2,
  Hash,
  History,
  Info,
  LayoutDashboard,
  Menu,
  MapPin,
  Maximize2,
  PackageCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Radar,
  Search,
  ScanLine,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  UserRound,
  UsersRound,
  X,
  Zap,
  LogOut,
} from 'lucide-react'

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
    return (
      <div className="avatar" style={{ width: size, height: size }}>
        <img src={image} alt={name || 'User'} referrerPolicy="no-referrer" />
      </div>
    )
  }
  return (
    <div className="avatar avatar-blank" style={{ width: size, height: size }}>
      <UserRound size={Math.round(size * 0.55)} />
    </div>
  )
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

function Topbar({ onMenu, onLogout, user }: {
    onMenu: () => void
    onLogout: () => void
    user: { name?: string | null; image?: string | null; role?: string | null }
  }) {
  return <header className="topbar">
    <button className="mobile-menu icon-button" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
    <div className="search-box"><Search size={17} /><input placeholder="Search inspections, products, evidence..." /><kbd>⌘ K</kbd></div>
    <div className="top-actions"><div className="location"><MapPin size={15} /><span>Kolkata, WB</span><ChevronRight size={13} /></div><div className="service-status"><i /> All systems operational</div><button className="icon-button notification"><Bell size={18} /><b>3</b></button></div><div className="officer" onClick={onLogout} style={{ cursor: 'pointer' }} title="Click to sign out">
      <Avatar name={user.name} image={user.image} size={36} />
      <div>
        <strong>{user.name || 'Officer'}</strong>
        <small>{ROLE_LABELS[user.role || ''] || 'Officer'}</small>
      </div>
      <LogOut size={15} style={{ marginLeft: '6px', color: '#64748b' }} />
    </div>
  </header>
}

function Sidebar({ active, setActive, collapsed, setCollapsed, user }: {
    active: string; setActive: (v: string) => void; collapsed: boolean; setCollapsed: (v: boolean) => void
    user: { name?: string | null; image?: string | null; role?: string | null }
  }) {
  let current = ''
  return <aside className={cn('sidebar', collapsed && 'collapsed')}>
    <div className="sidebar-head"><Logo /><button className="collapse-button" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar">{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    <div className="workspace"><span className="workspace-dot" /><div><strong>AI Compliance</strong><small>INTELLIGENCE PLATFORM</small></div></div>
    <nav>{nav.map((item) => { const show = current !== item.section; current = item.section; return <div key={item.view}>{show && !collapsed && <div className="nav-section">{item.section}</div>}<button title={item.label} className={cn('nav-item', active === item.view && 'active', item.accent && 'accent')} onClick={() => setActive(item.view)}><item.icon size={17} /><span>{item.label}</span>{item.accent && <span className="live-dot" />}</button></div> })}</nav>
      <div className="sidebar-bottom"><button className="nav-item" title="Notifications"><Bell size={17} /><span>Notifications</span><em>3</em></button><button className="nav-item" title="Help & Documentation"><Info size={17} /><span>Help & Documentation</span></button><div className="sidebar-profile">
        <Avatar name={user.name} image={user.image} size={32} />
        <div>
          <strong>{user.name || 'Officer'}</strong>
          <small>{ROLE_LABELS[user.role || ''] || 'Officer'}</small>
        </div>
        <Settings2 size={16} />
      </div>
    </div>
  </aside>
}

function Dashboard({ go }: { go: (view: string) => void }) {
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE OPERATIONS • 02 SEP 2026</div><h1>Enforcement Command Center</h1><p>Real-time compliance intelligence across inspections, products and manufacturers.</p></div><div className="heading-actions"><button className="button secondary"><Download size={16} /> Export brief</button><button className="button primary" onClick={() => go('inspection')}><ScanLine size={16} /> Start inspection <ArrowRight size={16} /></button></div></div>
    <div className="stats-grid"><StatCard icon={ClipboardCheck} label="Total inspections" value="12,540" change="↗ 14.8%" tone="blue" data={[32,45,38,62,52,76,68,82,74,92,88,100]} /><StatCard icon={AlertTriangle} label="Non-compliant" value="4,310" change="34.4%" tone="red" data={[70,64,78,61,68,54,58,48,52,42,46,38]} /><StatCard icon={Target} label="High-risk products" value="827" change="↗ 9.2%" tone="amber" data={[35,42,37,58,49,62,68,65,78,72,84,90]} /><StatCard icon={History} label="Repeat violations" value="312" change="↗ 6.7%" tone="purple" data={[30,26,44,35,52,48,60,57,70,64,78,76]} /><StatCard icon={BrainCircuit} label="AI detection confidence" value="94.6%" change="+2.1%" tone="green" data={[72,76,74,82,80,84,86,88,87,92,90,95]} /></div>
    <div className="dashboard-grid"><section className="hero-inspection"><div className="hero-grid" /><div className="hero-copy"><Badge tone="cyan"><Sparkles size={12} /> AI-GUIDED WORKFLOW</Badge><h2>Turn every package<br /><span>into evidence.</span></h2><p>Capture a package and let NiyamAI determine what evidence is still required — surface by surface.</p><div className="hero-buttons"><button className="button primary" onClick={() => go('inspection')}>Start AI inspection <ArrowRight size={16} /></button><button className="button ghost" onClick={() => go('capture')}><Hash size={16} /> Scan barcode</button></div></div><div className="hero-visual"><div className="scan-frame"><div className="package"><div className="package-top">NUTRITION<br /><b>XYZ</b></div><div className="package-label"><small>PREMIUM</small><strong>BISCUITS</strong><i>500 g</i></div><div className="package-seal">₹50</div></div><span className="box-label label-mrp">MRP <b>98%</b></span><span className="box-label label-qty">NET QTY <b>96%</b></span><span className="box-label label-maker">PACKER <b>91%</b></span><div className="scan-line" /></div></div></section>
      <section className="panel recommendations"><div className="panel-head"><div><div className="eyebrow purple-text"><Radar size={13} /> INTELLIGENCE SIGNAL</div><h3>AI Recommended Targets</h3></div><button className="text-button">View all <ArrowRight size={14} /></button></div><div className="recommendation-list">{[['01','ABC Foods Pvt Ltd','94','12 previous violations'],['02','XYZ Consumer Products','89','3 variants recently flagged'],['03','PQR Imports','84','Declaration pattern detected']].map((r, i) => <div className="recommendation" key={r[0]}><span className="rank">#{r[0]}</span><div className="rec-main"><strong>{r[1]}</strong><small>{r[3]}</small><div className="risk-track"><i style={{ width: `${r[2]}%` }} /></div></div><div className="risk-score"><b>{r[2]}</b><small>RISK</small></div><button className="mini-action" onClick={() => go('inspection')}><Eye size={15} /></button></div>)}</div></section>
      <section className="panel chart-panel"><div className="panel-head"><div><div className="eyebrow">30 DAY SIGNAL</div><h3>Violation trend</h3></div><button className="filter-button">Last 30 days <ChevronRight size={14} /></button></div><div className="chart-legend"><span><i className="legend-cyan" /> Violations detected</span><span><i className="legend-red" /> Declaration issues</span><span><i className="legend-amber" /> Readability</span></div><div className="line-chart"><div className="y-axis"><span>400</span><span>300</span><span>200</span><span>100</span><span>0</span></div><div className="chart-area"><div className="grid-lines" /><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-label="Violation trends"><polyline points="0,138 45,127 90,143 135,116 180,123 225,108 270,112 315,83 360,98 405,76 450,90 495,64 540,78 585,48 630,58 700,34" className="line-cyan" /><polyline points="0,159 45,146 90,152 135,137 180,145 225,127 270,135 315,111 360,119 405,106 450,112 495,91 540,98 585,82 630,88 700,67" className="line-red" /><polyline points="0,170 45,162 90,165 135,153 180,160 225,149 270,154 315,139 360,145 405,130 450,137 495,120 540,128 585,110 630,116 700,99" className="line-amber" /></svg><div className="x-axis"><span>04 Aug</span><span>11 Aug</span><span>18 Aug</span><span>25 Aug</span><span>02 Sep</span></div></div></div></section>
      <section className="panel category-panel"><div className="panel-head"><div><div className="eyebrow">DISTRIBUTION</div><h3>Category risk</h3></div><button className="icon-button"><SlidersHorizontal size={16} /></button></div><div className="category-bars">{[['Food',82,'red'],['Cosmetics',68,'amber'],['Household products',54,'blue'],['Imported goods',43,'purple'],['Other commodities',29,'cyan']].map(([name, value, tone]) => <div className="bar-row" key={String(name)}><div><span>{name}</span><b>{value}%</b></div><div className="bar"><i className={String(tone)} style={{ width: `${value}%` }} /></div></div>)}</div></section>
    </div>
    <section className="panel feed-panel"><div className="panel-head"><div><div className="eyebrow"><Activity size={13} /> LIVE FEED</div><h3>Recent inspections</h3></div><button className="text-button" onClick={() => go('history')}>Open repository <ArrowRight size={14} /></button></div><InspectionTable rows={inspections} go={go} /></section>
  </div>
}

function InspectionTable({ rows, go }: { rows: string[][]; go: (v: string) => void }) {
  return <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>LOCATION</th><th>OFFICER</th><th>STATUS</th><th>SCORE</th><th>TIME</th><th /></tr></thead><tbody>{rows.map((r) => <tr key={r[0]} onClick={() => go('product')}><td><strong>{r[0]}</strong><small className="mobile-sub">{r[1]}</small></td><td>{r[1]}</td><td>{r[2]}</td><td><Badge tone={r[3] === 'Compliant' ? 'green' : r[3] === 'Violation detected' ? 'red' : 'amber'}><i className="status-dot" /> {r[3]}</Badge></td><td><b className={cn('score', Number(r[4]) > 80 ? 'good' : Number(r[4]) > 60 ? 'warn' : 'bad')}>{r[4]}</b></td><td>{r[5]}</td><td><ChevronRight size={16} /></td></tr>)}</tbody></table></div>
}

function ProgressSteps({ active = 1 }: { active?: number }) { return <div className="progress-steps">{['Inspection','Capture','AI analysis','Compliance','Review','Report'].map((step, i) => <div className={cn('progress-step', i < active && 'done', i === active && 'current')} key={step}><span>{i < active ? <Check size={13} /> : `0${i + 1}`}</span><small>{step}</small></div>)}</div> }

function InspectionView({ go }: { go: (v: string) => void }) { return <div className="page-content narrow"><div className="page-heading"><div><div className="eyebrow">WORKFLOW / 01</div><h1>New inspection</h1><p>Create an evidence trail for a new packaged commodity inspection.</p></div><Badge tone="green"><CloudOff size={13} /> Offline-ready</Badge></div><ProgressSteps /><div className="form-layout"><section className="panel form-panel"><div className="section-title"><div className="step-number">01</div><div><h3>Inspection details</h3><p>Tell us where this inspection is happening.</p></div></div><div className="form-grid"><label>Inspection ID<input value="INS-2026-00126" readOnly /></label><label>Inspection type<select defaultValue="Physical store"><option>Physical store</option><option>Supermarket</option><option>Warehouse</option><option>E-Commerce</option></select></label><label className="wide">Location<div className="input-with-action"><input value="Kolkata, West Bengal" readOnly /><button className="inline-action"><MapPin size={15} /> Auto-detect</button></div></label><label className="wide">Premises / shop name<input placeholder="Enter premises name" defaultValue="CityMart — Ward 12" /></label><label className="wide">Inspection notes<textarea placeholder="Add observations for the audit trail..." defaultValue="Routine target inspection based on elevated manufacturer risk score." /></label></div><div className="form-footer"><span><ShieldCheck size={15} /> All changes are audit logged</span><button className="button primary" onClick={() => go('capture')}>Continue to capture <ArrowRight size={16} /></button></div></section><aside className="panel workflow-aside"><div className="eyebrow cyan-text"><Zap size={13} /> YOUR WORKFLOW</div><h3>AI-guided evidence</h3><p>NiyamAI will guide you surface by surface and only ask for what is still missing.</p><div className="workflow-list"><div><Check size={15} /> Capture package surfaces</div><div><Check size={15} /> Extract declarations</div><div><Check size={15} /> Evaluate configured rules</div><div><Check size={15} /> Review evidence & generate report</div></div><div className="aside-note"><Info size={15} /><span>Prototype mode<br /><b>Using fictional demo data</b></span></div></aside></div></div> }

function CaptureView({ go }: { go: (v: string) => void }) { return <div className="page-content capture-page"><div className="page-heading"><div><div className="eyebrow"><span className="pulse" /> LIVE CAMERA / INS-2026-00126</div><h1>AI-guided package inspection</h1><p>Capture each surface. NiyamAI will tell you what evidence is still required.</p></div><Badge tone="amber"><CloudOff size={13} /> Offline inspection mode</Badge></div><div className="capture-layout"><section className="camera-panel"><div className="camera-toolbar"><span><i className="record-dot" /> Camera 01</span><button className="icon-button"><Maximize2 size={16} /></button></div><div className="camera-view"><div className="camera-grid" /><div className="camera-corners" /><div className="camera-package"><div className="package-top">NUTRITION<br /><b>XYZ</b></div><div className="package-label"><small>PREMIUM</small><strong>BISCUITS</strong><i>500 g</i></div><div className="package-seal">₹50</div></div><div className="capture-box box-one"><span>PRODUCT DETECTED</span><b>98.2%</b></div><div className="capture-box box-two"><span>NET QUANTITY</span><b>96.8%</b></div><div className="camera-scan-line" /><div className="camera-tip"><ScanLine size={16} /> Align package within the frame</div></div><div className="camera-controls"><button className="button ghost"><Upload size={16} /> Upload image</button><button className="shutter" onClick={() => go('package')}><span /></button><button className="button ghost"><Hash size={16} /> Barcode</button></div></section><aside className="panel assistant-panel"><div className="assistant-header"><span className="ai-orb"><BrainCircuit size={18} /></span><div><div className="eyebrow purple-text">INSPECTION ASSISTANT</div><strong>Evidence guidance</strong></div><span className="live-pill">LIVE</span></div><div className="assistant-status"><div><Check size={15} /> Product identified <b>98%</b></div><div><Check size={15} /> Front surface captured <b>96%</b></div><div><Check size={15} /> Net Quantity detected <b>97%</b></div><div className="pending"><AlertTriangle size={15} /> MRP <b>Required</b></div><div className="pending"><AlertTriangle size={15} /> Manufacturer / packer <b>Required</b></div><div className="pending"><AlertTriangle size={15} /> Consumer care <b>Required</b></div></div><div className="assistant-message"><Sparkles size={16} /><p><strong>Next best action</strong>Rotate the package and capture the back surface.</p></div><button className="button primary full" onClick={() => go('package')}>Capture back <ArrowRight size={16} /></button><div className="surface-progress"><div className="eyebrow">CAPTURE PROGRESS <span>1 / 5</span></div><div className="surface-dots">{['Front','Back','Left','Right','Barcode'].map((s, i) => <div key={s} className={i === 0 ? 'captured' : ''}><span>{i === 0 ? <Check size={13} /> : '○'}</span><small>{s}</small></div>)}</div></div></aside></div></div> }

function PackageView({ go }: { go: (v: string) => void }) { return <div className="page-content"><div className="page-heading"><div><div className="eyebrow">WORKFLOW / 03 • PACKAGE INTELLIGENCE</div><h1>Multi-surface package understanding</h1><p>NiyamAI understands five captures as one physical package.</p></div><Badge tone="green"><Check size={13} /> 5 / 5 surfaces analyzed</Badge></div><div className="package-layout"><section className="panel reconstruction"><div className="reconstruction-stage"><div className="orbit orbit-a" /><div className="orbit orbit-b" /><div className="reconstructed-package"><div className="package-top">NUTRITION<br /><b>XYZ</b></div><div className="package-label"><small>PREMIUM</small><strong>BISCUITS</strong><i>500 g</i></div><div className="package-seal">₹50</div></div><div className="surface-node node-front"><Check size={12} /> FRONT</div><div className="surface-node node-back"><Check size={12} /> BACK</div><div className="surface-node node-left"><Check size={12} /> LEFT SIDE</div><div className="surface-node node-right"><Check size={12} /> RIGHT SIDE</div><div className="surface-node node-bottom"><Check size={12} /> BOTTOM</div></div><div className="surface-thumbnails">{['FRONT','BACK','LEFT SIDE','RIGHT SIDE','BOTTOM'].map((s, i) => <div className="surface-thumb" key={s}><div className={`thumb-art t${i}`} /><span><Check size={11} /> {s}</span></div>)}</div></section><aside className="panel declarations"><div className="eyebrow cyan-text">EXTRACTED SIGNALS</div><h3>Detected declarations</h3><div className="declaration-list">{[['Product name','XYZ Premium Biscuits','green'],['Net quantity','500 g','green'],['MRP','₹50','green'],['Manufacturer','ABC Foods Pvt Ltd','green'],['Packing date','08/2026','green'],['Consumer care','Not detected','amber']].map(([label, value, tone]) => <div key={label}><span className={tone === 'amber' ? 'warn-icon' : 'check-icon'}>{tone === 'amber' ? <AlertTriangle size={13} /> : <Check size={13} />}</span><div><small>{label}</small><strong>{value}</strong></div></div>)}</div><div className="confidence-row"><span>OCR confidence</span><b>94.8%</b></div><div className="confidence-bar"><i /></div><div className="quality-row"><span>Image quality</span><Badge tone="green">Excellent</Badge></div><button className="button primary full" onClick={() => go('extraction')}>Build compliance profile <ArrowRight size={16} /></button></aside></div></div> }

function ExtractionView({ go }: { go: (v: string) => void }) { return <div className="page-content"><div className="page-heading"><div><div className="eyebrow">WORKFLOW / 04 • HUMAN-IN-THE-LOOP</div><h1>Declaration extraction</h1><p>Review AI-extracted information before compliance evaluation.</p></div><Badge tone="purple"><BrainCircuit size={13} /> AI extraction complete</Badge></div><div className="extraction-layout"><section className="panel evidence-image"><div className="image-toolbar"><span><Eye size={15} /> Evidence crop / front_surface.jpg</span><Badge tone="cyan">OCR overlay on</Badge></div><div className="label-photo"><div className="fake-label"><small>XYZ FOODS</small><h2>PREMIUM<br />BISCUITS</h2><div className="fake-seal">₹50</div><p>Net Quantity: 500 g</p><p>Made for everyday moments</p></div><span className="ocr-box ocr-mrp">MRP ₹50 <b>98%</b></span><span className="ocr-box ocr-qty">Net Qty 500g <b>96%</b></span><span className="ocr-box ocr-date">Packed: 08/2026 <b>92%</b></span></div><div className="evidence-caption"><Fingerprint size={15} /> EV-2026-019283 <span>•</span> SHA-256 verified</div></section><section className="panel declaration-form"><div className="eyebrow">STRUCTURED DECLARATIONS</div><h3>Officer verification</h3>{[['Product name','XYZ Premium Biscuits','99% confidence'],['Manufacturer','ABC Foods Pvt Ltd','94% confidence'],['Net quantity','500 g','96% confidence'],['MRP','₹50','98% confidence'],['Packed on','08/2026','92% confidence'],['Consumer care','Not detected','Below threshold']].map(([label, value, confidence]) => <div className={cn('declaration-field', confidence === 'Below threshold' && 'field-warning')} key={label}><label>{label}<span className={confidence === 'Below threshold' ? 'low-confidence' : ''}>{confidence}</span></label><div><input value={value} readOnly /><button className="edit-button">{confidence === 'Below threshold' ? 'Review' : 'Edit'}</button></div></div>)}<div className="human-note"><UserRound size={15} /><span><b>Human verification required</b>AI suggestions are never final findings.</span></div><button className="button primary full" onClick={() => go('analysis')}>Confirm & run compliance check <ArrowRight size={16} /></button></section></div></div> }

function AnalysisView({ go }: { go: (v: string) => void }) { const [running, setRunning] = useState(false); return <div className="page-content analysis-page"><div className="page-heading center-heading"><div><div className="eyebrow"><span className="pulse" /> RULE ENGINE / PROCESSING</div><h1>Running compliance analysis</h1><p>AI extracts. Deterministic rules validate. You decide.</p></div></div><div className="analysis-layout"><section className="panel pipeline-panel"><div className="pipeline-head"><div><div className="eyebrow cyan-text">ANALYSIS PIPELINE</div><h3>Evidence to finding</h3></div><span className="analysis-percent">86%</span></div><div className="pipeline-progress"><i /></div><div className="pipeline-list">{[['Image quality','Complete','green'],['Package surface analysis','Complete','green'],['OCR extraction','Complete','green'],['Declaration classification','Complete','green'],['Rule version identification','Processing','cyan'],['Legal compliance check','Processing','cyan'],['Font & readability analysis','Waiting','muted'],['Evidence mapping','Waiting','muted']].map(([label,status,tone], i) => <div className={cn('pipeline-row', tone === 'cyan' && 'processing')} key={label}><span className={`pipeline-icon ${tone}`}>{tone === 'green' ? <Check size={14} /> : tone === 'cyan' ? <span className="spinner" /> : '○'}</span><span>{label}</span><b>{status}</b><small>0{i + 1}</small></div>)}</div></section><aside className="panel engine-panel"><div className="engine-title"><span className="ai-orb"><BrainCircuit size={20} /></span><div><div className="eyebrow purple-text">AI + RULE ENGINE</div><h3>Explainable compliance</h3></div></div><div className="engine-flow">{['Computer vision','OCR extraction','Structured data','Legal rule engine','Compliance result'].map((s, i) => <div key={s}><span>{i + 1}</span>{s}{i < 4 && <ArrowRight size={14} />}</div>)}</div><div className="engine-disclaimer"><Info size={15} /><p>AI identifies declarations. The configured rule engine performs the validation — not a generative model.</p></div><button className="button primary full" onClick={() => { setRunning(true); setTimeout(() => go('result'), 650) }}>{running ? 'Finalizing analysis...' : 'View compliance result'} <ArrowRight size={16} /></button></aside></div></div> }

function ResultView({ go }: { go: (v: string) => void }) { return <div className="page-content"><div className="page-heading"><div><div className="eyebrow">INSPECTION RESULT / INS-2026-00126</div><h1>Compliance result</h1><p>XYZ Premium Biscuits • ABC Foods Pvt Ltd</p></div><div className="heading-actions"><button className="button secondary" onClick={() => go('evidence')}><Eye size={16} /> View evidence</button><button className="button primary" onClick={() => go('report')}><FileText size={16} /> Generate report</button></div></div><div className="result-overview"><section className="panel score-panel"><div className="score-ring"><div><strong>68</strong><small>/ 100</small></div></div><div><Badge tone="amber">REVIEW REQUIRED</Badge><h3>Human verification needed</h3><p>3 findings require officer review before this case can be finalized.</p></div><div className="score-meta"><span>AI confidence <b>94.8%</b></span><span>Rule set <b>PC Rules • Prototype</b></span></div></section><section className="panel breakdown-panel"><div className="eyebrow">SCORE BREAKDOWN</div><h3>What shaped this score?</h3>{[['Mandatory declarations',72,'cyan'],['Format compliance',81,'blue'],['Readability',59,'amber'],['Font analysis',63,'red'],['Data consistency',74,'purple']].map(([label, value, tone]) => <div className="breakdown-row" key={String(label)}><div><span>{label}</span><b>{value}%</b></div><div className="breakdown-bar"><i className={String(tone)} style={{ width: `${value}%` }} /></div></div>)}</section></div><div className="section-heading"><div><div className="eyebrow red-text"><AlertTriangle size={13} /> FINDINGS</div><h2>Explainable violations</h2></div><Badge tone="muted">3 findings • 2 need review</Badge></div><div className="violation-grid">{[['CRITICAL','Consumer care information','Required declaration was not detected across analyzed package surfaces.','96%','red'],['REVIEW REQUIRED','Net quantity readability','Text detected but readability / size requires officer verification.','87%','amber'],['REVIEW REQUIRED','MRP placement','Declaration detected; placement requires manual confirmation.','81%','amber']].map(([tag,title,desc,conf,tone]) => <div className={`violation-card ${tone}`} key={title}><div className="violation-top"><Badge tone={tone === 'red' ? 'red' : 'amber'}>{tag}</Badge><span>{conf} confidence</span></div><h3>{title}</h3><p>{desc}</p><button className="text-button" onClick={() => go('evidence')}>View visual evidence <ArrowRight size={14} /></button></div>)}</div></div> }

function GenericModule({ view, go }: { view: string; go: (v: string) => void }) { const config: Record<string, { eyebrow: string; title: string; desc: string; icon: React.ElementType }> = { evidence: { eyebrow: 'SECURE AUDIT / 184 RECORDS', title: 'Evidence vault', desc: 'Cryptographically verified evidence linked to every inspection finding.', icon: Fingerprint }, product: { eyebrow: 'PRODUCT INTELLIGENCE / 2,481 PRODUCTS', title: 'Product intelligence', desc: 'Trace packaging declarations, inspection history and risk over time.', icon: Box }, manufacturer: { eyebrow: 'ENTITY INTELLIGENCE / 428 MANUFACTURERS', title: 'Manufacturer intelligence', desc: 'Identify repeat patterns and prioritize the next inspection target.', icon: UsersRound }, risk: { eyebrow: 'PREDICTIVE MODEL / PROTOTYPE METRICS', title: 'Predictive enforcement intelligence', desc: 'Identify where enforcement resources should be deployed next.', icon: Radar }, commerce: { eyebrow: 'DIGITAL MARKETPLACE / MONITOR', title: 'Digital marketplace inspector', desc: 'Compare online listings against physical package declarations.', icon: Globe2 }, rules: { eyebrow: 'RULE MANAGEMENT / PROTOTYPE', title: 'Legal rule intelligence', desc: 'Manage configured validation logic and versioned declaration requirements.', icon: FileCheck2 }, analytics: { eyebrow: 'DEMO DATA / LAST SYNC 4 MIN AGO', title: 'Compliance analytics', desc: 'See trends, regional signals and repeat offender distribution at a glance.', icon: BarChart3 }, history: { eyebrow: 'CASE REPOSITORY / 12,540 INSPECTIONS', title: 'Inspection repository', desc: 'Search, filter and review the complete inspection record.', icon: History } }; const c = config[view] || config.product; const Icon = c.icon; return <div className="page-content"><div className="page-heading"><div><div className="eyebrow"><Icon size={13} /> {c.eyebrow}</div><h1>{c.title}</h1><p>{c.desc}</p></div><button className="button primary" onClick={() => go(view === 'history' ? 'inspection' : 'inspection')}><ScanLine size={16} /> Start inspection</button></div><div className="module-toolbar panel"><div className="search-box module-search"><Search size={16} /><input placeholder="Search product, barcode, manufacturer, inspection ID..." /></div><button className="button secondary"><SlidersHorizontal size={16} /> Filters</button><button className="button secondary"><Download size={16} /> Export</button></div><div className="module-cards"><div className="panel module-hero"><div className="module-icon"><Icon size={23} /></div><div><Badge tone={view === 'risk' ? 'purple' : 'cyan'}>{view === 'risk' ? 'MODEL ACTIVE' : 'DEMO DATA'}</Badge><h2>{view === 'risk' ? 'Priority inspection targets' : view === 'evidence' ? 'Integrity verified across all evidence' : 'The signal behind every decision'}</h2><p>Designed for officer confidence: every data point links back to an inspection, a package surface, and a verifiable evidence record.</p><button className="text-button" onClick={() => go('capture')}>Open guided workflow <ArrowRight size={14} /></button></div></div><div className="panel mini-metric"><span>Open cases</span><strong>{view === 'risk' ? '827' : '1,248'}</strong><Badge tone="amber">Needs review</Badge></div><div className="panel mini-metric"><span>Verified records</span><strong>{view === 'evidence' ? '184' : '94.8%'}</strong><Badge tone="green">↑ Healthy</Badge></div></div>{view === 'history' || view === 'manufacturer' ? <section className="panel feed-panel"><div className="panel-head"><div><div className="eyebrow">CASE DATA</div><h3>{view === 'history' ? 'Inspection repository' : 'Priority manufacturers'}</h3></div><button className="filter-button">Updated today <ChevronRight size={14} /></button></div><InspectionTable rows={inspections} go={go} /></section> : <div className="empty-state panel"><div className="empty-icon"><Icon size={25} /></div><h3>Intelligence module ready</h3><p>Connect this prototype surface to your backend data source when your SIH architecture is finalized.</p><button className="button secondary" onClick={() => go('overview')}>Back to command center</button></div>}</div> }

function ReportView({ go }: { go: (v: string) => void }) { return <div className="page-content"><div className="page-heading"><div><div className="eyebrow">CASE CLOSURE / INS-2026-00126</div><h1>Generate inspection report</h1><p>Evidence-based report preview ready for officer review.</p></div><div className="heading-actions"><button className="button secondary"><Download size={16} /> Generate PDF</button><button className="button primary" onClick={() => go('history')}><ShieldCheck size={16} /> Save case</button></div></div><div className="report-layout"><section className="report-paper"><div className="report-header"><div className="emblem"><ScanLine size={22} /></div><div><small>GOVERNMENT OF WEST BENGAL</small><h2>LEGAL METROLOGY DEPARTMENT</h2><span>Inspection intelligence report • Prototype</span></div><b>INS-2026-00126</b></div><div className="report-rule" /><div className="report-status"><div><small>COMPLIANCE RESULT</small><strong>68 / 100</strong></div><Badge tone="amber">REVIEW REQUIRED</Badge></div><div className="report-grid"><div><small>PRODUCT</small><strong>XYZ Premium Biscuits</strong></div><div><small>MANUFACTURER</small><strong>ABC Foods Pvt Ltd</strong></div><div><small>LOCATION</small><strong>Kolkata, West Bengal</strong></div><div><small>INSPECTING OFFICER</small><strong>Arjun Sen • WB-LM-042</strong></div></div><div className="report-section"><h4>Findings</h4><p><b>01</b> Consumer care information — not detected across analyzed surfaces.</p><p><b>02</b> Net quantity readability — requires officer verification.</p><p><b>03</b> MRP placement — requires manual confirmation.</p></div><div className="report-section"><h4>Evidence & audit</h4><p>7 source images • 3 AI evidence crops • SHA-256 integrity verified • 18:42:17 IST</p></div><div className="signature-line"><span>Officer verification</span><span>Digital audit trail attached</span></div></section><aside className="panel report-aside"><div className="eyebrow">REPORT SECTIONS</div>{['Inspection details','Product details','Declarations','Compliance result','Violation details','Applicable rule references','Evidence','Officer observations','Audit information'].map((s, i) => <div className="report-section-row" key={s}><span>{i < 7 ? <Check size={14} /> : '○'}</span>{s}<ChevronRight size={14} /></div>)}<div className="aside-note"><Info size={15} /><span>Prototype report<br /><b>Rule references require department configuration.</b></span></div></aside></div></div> }

export default function NiyamAIApp({ initialView = 'overview' }: { initialView?: string }) {
  const { data: session } = useSession()              
  const user = {                                        
    name: session?.user?.name,
    image: session?.user?.image,
    role: session?.user?.role,
  }
  const [active, setActive] = useState(initialView)
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutModal, setShowLogoutModal] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const routeMap: Record<string, string> = { overview: '/dashboard', inspection: '/inspection', capture: '/capture', package: '/package', extraction: '/extraction', analysis: '/analysis', result: '/result', evidence: '/evidence', report: '/report', history: '/history', product: '/products', manufacturer: '/manufacturers', risk: '/risk', commerce: '/commerce', rules: '/rules', analytics: '/analytics', profile: '/profile' }

  const go = (v: string) => { setActive(v); setMobileOpen(false); window.history.pushState({}, '', routeMap[v] || '/dashboard'); window.scrollTo({ top: 0, behavior: 'smooth' }) }

  const handleLogout = async () => {
    setLoggingOut(true)
    await signOut({ callbackUrl: '/login', redirect: true })
  }

  let view: React.ReactNode
  if (active === 'overview') view = <Dashboard go={go} />
  else if (active === 'inspection') view = <InspectionView go={go} />
  else if (active === 'capture') view = <CaptureView go={go} />
  else if (active === 'package') view = <PackageView go={go} />
  else if (active === 'extraction') view = <ExtractionView go={go} />
  else if (active === 'analysis') view = <AnalysisView go={go} />
  else if (active === 'result') view = <ResultView go={go} />
  else if (active === 'report') view = <ReportView go={go} />
  else view = <GenericModule view={active} go={go} />

  return (
    <div className="app-shell">
      <Sidebar active={active} setActive={go} collapsed={collapsed} setCollapsed={setCollapsed} user={user} />
      <div className={cn('main-shell', mobileOpen && 'mobile-open')}>
        <Topbar onMenu={() => setMobileOpen(true)} onLogout={() => setShowLogoutModal(true)} user={user} />
        <main>{view}</main>
        <div className="mobile-nav">
          {[['overview',LayoutDashboard,'Home'],['inspection',ScanLine,'Inspect'],['history',History,'History'],['evidence',Fingerprint,'Evidence'],['profile',UserRound,'Profile']].map(([v, Icon, label]) =>
            <button className={active === v ? 'active' : ''} key={String(v)} onClick={() => go(String(v))}><Icon size={19} /><span>{label}</span></button>
          )}
        </div>
      </div>
      {mobileOpen && <button className="mobile-overlay" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      {showLogoutModal && (
        <div className="logout-overlay" onClick={() => !loggingOut && setShowLogoutModal(false)}>
          <div className="logout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="logout-icon-wrap">
              <LogOut size={26} />
            </div>
            <div className="logout-eyebrow">SECURE SESSION</div>
            <h3 className="logout-title">Sign out of NiyamAI?</h3>
            <p className="logout-desc">You will be redirected to the login page. All protected routes will require authentication again.</p>
            <div className="logout-actions">
              <button className="button secondary logout-cancel" onClick={() => setShowLogoutModal(false)} disabled={loggingOut}>
                Cancel
              </button>
              <button className="button logout-confirm" onClick={handleLogout} disabled={loggingOut}>
                <LogOut size={16} />
                {loggingOut ? 'Signing out...' : 'Yes, sign out'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { NiyamAIApp }
