'use client'

import { useState, useEffect } from 'react'
import { BarChart3, TrendingUp, AlertTriangle, Building2, Repeat } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'

type AnalyticsData = {
  violationTrends: { month: string; inspections: number; violations: number }[]
  mostCommonViolations: { title: string; count: number }[]
  stateWiseCompliance: { state: string; total: number; compliant: number; nonCompliant: number; reviewRequired: number; complianceRate: number }[]
  repeatViolators: { company: string; nonCompliantCount: number }[]
  companyProductViolations: { company: string; product: string; totalInspections: number; totalViolations: number }[]
}

export function AnalyticsView() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/analytics')
      .then((res) => { if (!res.ok) throw new Error('Failed to load analytics'); return res.json() })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load analytics'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><BarChart3 size={13} /> ANALYTICS</div>
          <h1>Compliance analytics</h1>
          <p>Trends, common violations, state-wise compliance and repeat offenders.</p>
        </div>
      </div>

      {loading && <p style={{ color: '#64748b', fontSize: 12 }}>Loading analytics...</p>}
      {error && <p style={{ color: '#ef4444', fontSize: 12 }}>{error}</p>}

      {data && (
        <>
          <section className="panel" style={{ padding: 16, marginBottom: 20 }}>
            <div className="eyebrow"><Building2 size={13} /> COMPANY & PRODUCT</div>
            <h3 style={{ marginBottom: 12 }}>Ranked by violation count (highest first)</h3>
            {data.companyProductViolations.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No violations recorded yet.</p>}
            {data.companyProductViolations.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>COMPANY</th><th>PRODUCT</th><th>INSPECTIONS</th><th>VIOLATIONS</th></tr></thead>
                  <tbody>
                    {data.companyProductViolations.map((cp) => (
                      <tr key={`${cp.company}-${cp.product}`}>
                        <td><strong>{cp.company}</strong></td>
                        <td>{cp.product}</td>
                        <td>{cp.totalInspections}</td>
                        <td><b className={`score ${cp.totalViolations === 0 ? 'good' : cp.totalViolations < 3 ? 'warn' : 'bad'}`}>{cp.totalViolations}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel" style={{ padding: 16, marginBottom: 20 }}>
            <div className="eyebrow">STATE-WISE COMPLIANCE</div>
            <h3 style={{ marginBottom: 12 }}>Compliance rate by state</h3>
            <div className="table-wrap">
              <table>
                <thead><tr><th>STATE</th><th>TOTAL</th><th>COMPLIANT</th><th>NON-COMPLIANT</th><th>REVIEW</th><th>RATE</th></tr></thead>
                <tbody>
                  {data.stateWiseCompliance.map((s) => (
                    <tr key={s.state}>
                      <td><strong>{s.state}</strong></td>
                      <td>{s.total}</td>
                      <td>{s.compliant}</td>
                      <td>{s.nonCompliant}</td>
                      <td>{s.reviewRequired}</td>
                      <td><b className={`score ${s.complianceRate > 80 ? 'good' : s.complianceRate > 60 ? 'warn' : 'bad'}`}>{s.complianceRate}%</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel" style={{ padding: 16 }}>
            <div className="eyebrow"><Repeat size={13} /> REPEAT VIOLATORS</div>
            <h3 style={{ marginBottom: 12 }}>Companies with 2+ non-compliant inspections</h3>
            {data.repeatViolators.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No repeat violators found.</p>}
            <div className="inspection-row-list">
              {data.repeatViolators.map((r) => (
                <div key={r.company} className="inspection-row">
                  <div className="inspection-row-body"><strong>{r.company}</strong></div>
                  <span className="badge badge-red">{r.nonCompliantCount} non-compliant</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}