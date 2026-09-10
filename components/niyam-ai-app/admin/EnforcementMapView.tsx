'use client'

import { useState, useEffect, useMemo } from 'react'
import { ComposableMap, Geographies, Geography, Marker, ZoomableGroup } from 'react-simple-maps'
import { geoCentroid } from 'd3-geo'
import { Building2, AlertTriangle, ChevronRight, MapPin, Plus, Minus } from 'lucide-react'

const INDIA_TOPOJSON_URL = 'https://raw.githubusercontent.com/udit-001/india-maps-data/master/geojson/india.geojson'
const INDIA_DISTRICTS_GEOJSON_URL = 'https://raw.githubusercontent.com/geohacker/india/master/district/india_district.geojson'

type CompanyNode = { company: string; totalInspections: number; totalViolations: number; violationTypes: string[]; history: any[] }
type CityNode = { city: string; totalInspections: number; totalViolations: number; latitude: number | null; longitude: number | null; companies: CompanyNode[] }
type StateNode = { state: string; totalInspections: number; totalViolations: number; cities: CityNode[] }
type DistrictInfo = { name: string; state: string; center: [number, number] }
type SearchResult = { state: StateNode; city?: CityNode; district?: { name: string; center: [number, number] } }

// OSM/Nominatim state names occasionally differ from the topojson's NAME_1
// property. Extend this map if a state isn't colouring correctly on the map.
const NAME_ALIASES: Record<string, string> = {
  'nct of delhi': 'delhi',
  'andaman and nicobar island': 'andaman and nicobar islands',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  odisha: 'orissa',
  uttarakhand: 'uttaranchal',
}
const normalize = (name: string) => {
  const n = name.trim().toLowerCase().replace(/[&]/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  return NAME_ALIASES[n] || n
}

const STATE_CENTERS: Record<string, [number, number]> = {
  'andhra pradesh': [79.7, 15.9],
  'assam': [92.9, 26.2],
  'bihar': [85.3, 25.7],
  'chhattisgarh': [81.9, 21.3],
  'west bengal': [87.85, 23.5],
  'delhi': [77.1, 28.7],
  'goa': [74.1, 15.3],
  'gujarat': [71.5, 22.3],
  'haryana': [76.2, 29.1],
  'himachal pradesh': [77.2, 31.8],
  'jharkhand': [85.5, 23.6],
  'kerala': [76.3, 10.4],
  'maharashtra': [75.7, 19.3],
  'madhya pradesh': [78.2, 23.5],
  'odisha': [84.5, 20.5],
  'punjab': [75.4, 31.1],
  'rajasthan': [73.8, 27.0],
  'sikkim': [88.5, 27.5],
  'karnataka': [76.2, 15.3],
  'tamil nadu': [78.5, 11.1],
  'telangana': [79.1, 17.9],
  'uttar pradesh': [80.8, 26.8],
  'uttarakhand': [79.2, 30.1],
}

const CITY_CENTERS: Record<string, [number, number]> = {
  kolkata: [88.3639, 22.5726],
  howrah: [88.2636, 22.5958],
  siliguri: [88.3953, 26.7271],
  asansol: [87.2914, 23.6739],
  durgapur: [87.3119, 23.5204],
  haldia: [88.0698, 22.0667],
  mumbai: [72.8777, 19.076],
  delhi: [77.1025, 28.7041],
  bengaluru: [77.5946, 12.9716],
  chennai: [80.2707, 13.0827],
  hyderabad: [78.4867, 17.385],
}

const STATE_COLORS = ['#f6d6c8', '#d7e8f7', '#f4e8b8', '#d9efd8', '#ead8f2', '#f7dfb5', '#d2e8e1', '#f1d5dd']

export function EnforcementMapView() {
  const [data, setData] = useState<StateNode[]>([])
  const [stateGeography, setStateGeography] = useState<any>(null)
  // NEW — cached once, reused for every state drilldown instead of being
  // re-fetched (via the `geography` prop URL) on every state click. That
  // re-fetch-per-click was the main cause of the map feeling slow when
  // going back and forth between states.
  const [districtGeography, setDistrictGeography] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedState, setSelectedState] = useState<StateNode | null>(null)
  const [selectedCity, setSelectedCity] = useState<CityNode | null>(null)
  const [selectedCompany, setSelectedCompany] = useState<CompanyNode | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [mapCenter, setMapCenter] = useState<[number, number]>([82, 23.5])
  const [mapZoom, setMapZoom] = useState(1)

  useEffect(() => {
    fetch('/api/admin/enforcement-map')
      .then((res) => { if (!res.ok) throw new Error('Failed to load map data'); return res.json() })
      .then((d) => setData(d.states || []))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load map data'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch(INDIA_TOPOJSON_URL)
      .then((res) => res.json())
      .then(setStateGeography)
      .catch(() => undefined)
  }, [])

  // NEW — fetch the district geojson once up front instead of on-demand
  // per state click.
  useEffect(() => {
    fetch(INDIA_DISTRICTS_GEOJSON_URL)
      .then((res) => res.json())
      .then(setDistrictGeography)
      .catch(() => undefined)
  }, [])

  const byNormalizedName = useMemo(() => {
    const m = new Map<string, StateNode>()
    data.forEach((s) => m.set(normalize(s.state), s))
    return m
  }, [data])

  // NEW — flat index of every district (name + owning state + centroid),
  // built once whenever the district geojson finishes loading. Powers both
  // district search and the "nearest district -> nearest city" lookup used
  // when a district is clicked directly on the map.
  const allDistricts = useMemo<DistrictInfo[]>(() => {
    if (!districtGeography?.features) return []
    return districtGeography.features
      .map((f: any) => {
        const props = f.properties || {}
        const name = props.NAME_2 || props.district || props.dt_name || props.name || ''
        const state = props.st_nm || props.NAME_1 || props.state || ''
        let center: [number, number] = [82, 23.5]
        try { center = geoCentroid(f) as [number, number] } catch { /* skip bad geometry */ }
        return { name, state, center }
      })
      .filter((d: DistrictInfo) => d.name)
  }, [districtGeography])

  // UPDATED — search now also matches district names, not just states/cities.
  const searchResults = useMemo<SearchResult[]>(() => {
    const query = normalize(searchTerm)
    if (!query) return []
    const results: SearchResult[] = []
    for (const state of data) {
      if (normalize(state.state).includes(query)) results.push({ state })
      for (const city of state.cities) {
        if (normalize(city.city).includes(query)) results.push({ state, city })
      }
    }
    for (const d of allDistricts) {
      if (normalize(d.name).includes(query)) {
        const stateNode = byNormalizedName.get(normalize(d.state)) || { state: d.state, totalInspections: 0, totalViolations: 0, cities: [] }
        results.push({ state: stateNode, district: { name: d.name, center: d.center } })
      }
    }
    return results.slice(0, 8)
  }, [data, searchTerm, allDistricts, byNormalizedName])

  const coordinatesForCity = (city: CityNode, stateName = '') => {
    if (city.longitude != null && city.latitude != null) return [city.longitude, city.latitude] as [number, number]
    const knownCenter = CITY_CENTERS[normalize(city.city)]
    if (knownCenter) return knownCenter
    const stateCenter = STATE_CENTERS[normalize(stateName)] || [82, 23.5]
    const hash = normalize(city.city).split('').reduce((sum, character) => sum + character.charCodeAt(0), 0)
    return [stateCenter[0] + ((hash % 7) - 3) * 0.12, stateCenter[1] + ((Math.floor(hash / 7) % 7) - 3) * 0.1] as [number, number]
  }

  // UPDATED — capped + sorted so the "zoomed out, no state selected" view
  // doesn't render a marker for every single city in the whole dataset,
  // which was the other big contributor to slow pan/zoom performance.
  const visibleCities = useMemo(() => {
    if (selectedState) return selectedState.cities
    if (mapZoom < 1.8) return []
    return data
      .flatMap((state) => state.cities)
      .sort((a, b) => b.totalViolations - a.totalViolations)
      .slice(0, 60)
  }, [selectedState, mapZoom, data])

  const drilldownLabelSize = Math.max(1.8, 6 / mapZoom)

  const colorForGeoState = (geoName: string) => {
    const index = normalize(geoName).split('').reduce((sum, character) => sum + character.charCodeAt(0), 0) % STATE_COLORS.length
    return STATE_COLORS[index]
  }

  const handleStateClick = (geoName: string, center?: [number, number]) => {
    setSelectedCompany(null)
    setSelectedCity(null)
    const node = byNormalizedName.get(normalize(geoName))
    setSelectedState(node || { state: geoName, totalInspections: 0, totalViolations: 0, cities: [] })
    setMapCenter(center || STATE_CENTERS[normalize(geoName)] || [82, 23.5])
    setMapZoom(3.2)
  }

  // NEW — clicking a district in the drilldown view. Inspections aren't
  // tagged with a district in the schema (only city), so this resolves to
  // the nearest city that actually has data and opens that city's panel —
  // same fallback the search dropdown uses for district matches.
  const handleDistrictClick = (state: StateNode, districtName: string, center: [number, number]) => {
    setMapCenter(center)
    setMapZoom(5)
    if (state.cities.length === 0) return
    let nearest = state.cities[0]
    let nearestDist = Infinity
    for (const city of state.cities) {
      const [lng, lat] = coordinatesForCity(city, state.state)
      const dist = Math.hypot(lng - center[0], lat - center[1])
      if (dist < nearestDist) { nearestDist = dist; nearest = city }
    }
    handleCityClick(state, nearest)
  }

  const selectSearchResult = (result: SearchResult) => {
    setSelectedCompany(null)
    setSelectedState(result.state)
    setSelectedCity(result.city || null)
    if (result.district) {
      setMapCenter(result.district.center)
      setMapZoom(5)
    } else {
      const cityCoordinates = result.city ? coordinatesForCity(result.city, result.state.state) : undefined
      if (cityCoordinates) {
        setMapCenter(cityCoordinates)
        setMapZoom(5)
      } else {
        setMapCenter(STATE_CENTERS[normalize(result.state.state)] || [82, 23.5])
        setMapZoom(3.2)
      }
    }
    setSearchTerm('')
  }

  const handleCityClick = (state: StateNode, city: CityNode) => {
    const coordinates = coordinatesForCity(city, state.state)
    setSelectedCompany(null)
    setSelectedState(state)
    setSelectedCity(city)
    if (coordinates) {
      setMapCenter(coordinates)
      setMapZoom(5)
    }
  }

  const resetToStates = () => { setSelectedState(null); setSelectedCity(null); setSelectedCompany(null); setMapCenter([82, 23.5]); setMapZoom(1) }
  const resetToCities = () => { setSelectedCity(null); setSelectedCompany(null) }
  const resetToCompanies = () => setSelectedCompany(null)

  return (
    <div className="page-content">
      <div className="page-heading">
        <div>
          <div className="eyebrow"><MapPin size={13} /> INTELLIGENCE</div>
          <h1>India Enforcement Map</h1>
          <p>Inspection density and violation intensity across states, cities and companies.</p>
        </div>
      </div>

      {error && <p style={{ color: '#ef4444', fontSize: 12, marginBottom: 12 }}>{error}</p>}
      {loading && <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>Loading enforcement data...</p>}

      <div className="form-layout" style={{ alignItems: 'flex-start' }}>
        <section className="panel" style={{ padding: 12, position: 'relative' }}>
            <div style={{ position: 'absolute', zIndex: 2, top: 20, left: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <button aria-label="Zoom in" title="Zoom in" onClick={() => setMapZoom((zoom) => Math.min(5, zoom + 0.5))} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card)', color: 'inherit', cursor: 'pointer' }}><Plus size={15} /></button>
              <button aria-label="Zoom out" title="Zoom out" onClick={() => setMapZoom((zoom) => Math.max(1, zoom - 0.5))} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card)', color: 'inherit', cursor: 'pointer' }}><Minus size={15} /></button>
            </div>
            <ComposableMap projection="geoMercator" projectionConfig={{ scale: 760, center: [82, 23.5] }} width={520} height={520} style={{ width: '100%', height: 'auto' }}>
              <ZoomableGroup
                center={mapCenter}
                zoom={mapZoom}
                filterZoomEvent={(event) => (event as any).type !== 'wheel'}
                onMoveEnd={({ coordinates, zoom }) => {
                  setMapCenter(coordinates || mapCenter)
                  setMapZoom(zoom ?? mapZoom)
                }}
              >
                <Geographies geography={selectedState ? (districtGeography || INDIA_DISTRICTS_GEOJSON_URL) : (stateGeography || INDIA_TOPOJSON_URL)}>
                {({ geographies }) => {
                    if (!geographies || geographies.length === 0) return null
                    const selectedStateKey = selectedState ? normalize(selectedState.state) : null
                    const mapGeographies = selectedStateKey
                      ? geographies.filter((geo) => normalize(geo?.properties?.st_nm || geo?.properties?.NAME_1 || geo?.properties?.name || '') === selectedStateKey)
                      : geographies
                    const stateGeographies = new Map<string, { name: string; features: any[] }>()
                    mapGeographies.forEach((geo) => {
                      const properties = geo?.properties ?? {}
                      const name = properties.st_nm || properties.NAME_1 || properties.name || ''
                      const key = normalize(name)
                      const state: { name: string; features: any[] } = stateGeographies.get(key) || { name, features: [] }
                      state.features.push(geo)
                      stateGeographies.set(key, state)
                    })
                    return (
                      <>
                        {mapGeographies.map((geo) => {
                          const properties = geo?.properties ?? {}
                          const geoName = properties.st_nm || properties.NAME_1 || properties.name || ''
                          const geoFill = colorForGeoState(geoName)
                          const stateFeatures = stateGeographies.get(normalize(geoName))?.features || [geo]
                          const stateCenter = geoCentroid({ type: 'FeatureCollection', features: stateFeatures }) as [number, number]
                          const mapStyle: any = {
                            default: { fill: geoFill, stroke: '#0f172a', strokeWidth: 0.5, outline: 'none', cursor: 'pointer' },
                            hover: { fill: '#38bdf8', stroke: '#0f172a', strokeWidth: 0.5, outline: 'none', cursor: 'pointer' },
                            pressed: { fill: '#0ea5e9', outline: 'none' },
                          }
                          return (
                            <Geography
                              key={geo.rsmKey}
                              geography={geo}
                              onClick={() => {
                                // UPDATED — when a state is already selected we're
                                // looking at districts, so route the click through
                                // handleDistrictClick instead of re-selecting the state.
                                if (selectedState) {
                                  const districtName = properties.NAME_2 || properties.district || properties.dt_name || properties.name || ''
                                  handleDistrictClick(selectedState, districtName, stateCenter)
                                } else {
                                  handleStateClick(geoName, stateCenter)
                                }
                              }}
                              fill={geoFill}
                              stroke="#475569"
                              strokeWidth={0.6}
                              style={mapStyle}
                            />
                          )
                        })}
                        {!selectedState && Array.from(stateGeographies.entries()).map(([key, { name, features }]) => {
                          const center = geoCentroid({ type: 'FeatureCollection', features }) as [number, number]
                          return <Marker key={key} coordinates={center}>
                            <text textAnchor="middle" dominantBaseline="central" style={{ fontSize: 6.5, fontWeight: 700, fill: '#334155', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 2, pointerEvents: 'none' }}>{name}</text>
                          </Marker>
                        })}
                        {selectedState && Array.from(new Map(mapGeographies.map((geo) => {
                          const properties = geo?.properties ?? {}
                          const name = properties.NAME_2 || properties.district || properties.dt_name || properties.name || ''
                          return [normalize(name), { name, geo }] as const
                        })).values()).map(({ name, geo }) => (
                          <Marker key={name} coordinates={geoCentroid(geo) as [number, number]}>
                            <text textAnchor="middle" dominantBaseline="central" style={{ fontSize: drilldownLabelSize, fontWeight: 600, fill: '#334155', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 0.5 / mapZoom, pointerEvents: 'none' }}>{name}</text>
                          </Marker>
                        ))}
                      </>
                    )
                }}
                </Geographies>
                {visibleCities.map((city) => {
                  const state = selectedState || data.find((candidate) => candidate.cities.some((item) => item.city === city.city))
                  if (!state) return null
                  const coordinates = coordinatesForCity(city, state.state)
                  return (
                    <Marker key={`${state.state}-${city.city}`} coordinates={coordinates} onClick={() => handleCityClick(state, city)}>
                      <circle r={selectedCity?.city === city.city ? 5 : 3} fill="#0f766e" stroke="#fff" strokeWidth={1.5} />
                      <text x={7} y={3} style={{ fontSize: selectedState ? drilldownLabelSize : 6, fontWeight: 600, fill: '#334155', paintOrder: 'stroke', stroke: '#fff', strokeWidth: selectedState ? 0.5 / mapZoom : 0, pointerEvents: 'none' }}>{city.city}</text>
                    </Marker>
                  )
                })}
              </ZoomableGroup>
            </ComposableMap>
        </section>

        <aside className="panel" style={{ padding: 16, minWidth: 320, flex: 1 }}>
          <div style={{ position: 'relative', marginBottom: 14 }}>
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Search state, district or city"
              style={{ width: '100%', padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', color: 'inherit' }}
            />
            {searchResults.length > 0 && (
              <div style={{ marginTop: 4, padding: 4, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--card)', boxShadow: '0 8px 20px rgba(0,0,0,.18)' }}>
                {searchResults.map((result) => (
                  <button key={`${result.state.state}-${result.city?.city || result.district?.name || 'state'}`} onClick={() => selectSearchResult(result)} style={{ display: 'block', width: '100%', padding: '8px 9px', border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                    <strong>{result.district?.name || result.city?.city || result.state.state}</strong>
                    <small style={{ display: 'block', color: '#64748b' }}>
                      {result.district
                        ? `${result.state.state} district`
                        : result.city
                          ? `${result.state.state} • ${result.city.totalViolations} violations`
                          : `${result.state.totalViolations} violations`}
                    </small>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="text-button" onClick={resetToStates}>All states</button>
            {selectedState && <><ChevronRight size={12} /><button className="text-button" onClick={resetToCities}>{selectedState.state}</button></>}
            {selectedCity && <><ChevronRight size={12} /><button className="text-button" onClick={resetToCompanies}>{selectedCity.city}</button></>}
            {selectedCompany && <><ChevronRight size={12} /><span>{selectedCompany.company}</span></>}
          </div>

          {!selectedState && (
            <>
              <h3 style={{ marginBottom: 8 }}>State summary</h3>
              {data.length === 0 && !loading && <p style={{ color: '#64748b', fontSize: 13 }}>No inspections with location data yet.</p>}
              <div className="inspection-row-list">
                {[...data].sort((a, b) => b.totalInspections - a.totalInspections).map((s) => (
                  <div key={s.state} className="inspection-row" onClick={() => handleStateClick(s.state)} style={{ cursor: 'pointer' }}>
                    <div className="inspection-row-body">
                      <strong>{s.state}</strong>
                      <small>{s.totalInspections} inspections • {s.totalViolations} violations</small>
                    </div>
                    <ChevronRight size={16} />
                  </div>
                ))}
              </div>
            </>
          )}

          {selectedState && !selectedCity && (
            <>
              <h3 style={{ marginBottom: 4 }}>{selectedState.state}</h3>
              <p style={{ color: '#64748b', fontSize: 12, marginBottom: 12 }}>{selectedState.totalInspections} inspections • {selectedState.totalViolations} violations</p>
              {selectedState.cities.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No inspections recorded here yet.</p>}
              <div className="inspection-row-list">
                {[...selectedState.cities].sort((a, b) => b.totalInspections - a.totalInspections).map((c) => (
                  <div key={c.city} className="inspection-row" onClick={() => setSelectedCity(c)} style={{ cursor: 'pointer' }}>
                    <div className="inspection-row-body">
                      <strong>{c.city}</strong>
                      <small>{c.totalInspections} inspections • {c.totalViolations} violations</small>
                    </div>
                    <ChevronRight size={16} />
                  </div>
                ))}
              </div>
            </>
          )}

          {selectedCity && !selectedCompany && (
            <>
                <h3 style={{ marginBottom: 4 }}>{selectedCity.city}</h3>
                <p style={{ color: '#64748b', fontSize: 12, marginBottom: 8 }}>{selectedCity.totalInspections} inspections • {selectedCity.totalViolations} violations</p>
                {/* aggregated violation types across every company in this city, so you don't have to open a company to see what's wrong here */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {Array.from(new Set(selectedCity.companies.flatMap((c) => c.violationTypes))).map((t) => (
                    <span key={t} className="badge badge-amber"><AlertTriangle size={11} /> {t}</span>
                ))}
                {selectedCity.totalViolations === 0 && <span className="badge badge-green">No recorded violations</span>}
                </div>
                {selectedCity.companies.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No inspections recorded here yet.</p>}
                <div className="inspection-row-list">
                {[...selectedCity.companies].sort((a, b) => b.totalViolations - a.totalViolations).map((co) => (
                    <div key={co.company} className="inspection-row" onClick={() => setSelectedCompany(co)} style={{ cursor: 'pointer' }}>
                    <div className="inspection-row-img"><Building2 size={18} /></div>
                    <div className="inspection-row-body">
                        <strong>{co.company}</strong>
                        <small>{co.totalInspections} inspections • {co.totalViolations} violations</small>
                    </div>
                    <ChevronRight size={16} />
                    </div>
                ))}
                </div>
            </>
            )}

          {selectedCompany && (
            <>
              <h3 style={{ marginBottom: 4 }}>{selectedCompany.company}</h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {selectedCompany.violationTypes.map((t) => (
                  <span key={t} className="badge badge-amber"><AlertTriangle size={11} /> {t}</span>
                ))}
                {selectedCompany.violationTypes.length === 0 && <span className="badge badge-green">No recorded violations</span>}
              </div>
              <h4 style={{ fontSize: 13, marginBottom: 8, color: '#94a3b8' }}>Inspection history</h4>
              <div className="inspection-row-list">
                {selectedCompany.history.map((h) => (
                  <div key={h.id} className="inspection-row">
                    <div className="inspection-row-body">
                      <strong>{h.inspectionId}</strong>
                      <small>{new Date(h.date).toLocaleDateString()} • {h.violations?.length || 0} finding(s)</small>
                    </div>
                    <span className={`badge ${h.status === 'COMPLIANT' || h.status === 'compliant' ? 'badge-green' : h.status === 'NON-COMPLIANT' || h.status === 'non_compliant' ? 'badge-red' : 'badge-amber'}`}>
                      {h.status}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  )
}