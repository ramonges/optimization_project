import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import { bool, fetchCsv, normalizeZip, num, type CsvRow } from '../utils/csv'

type MetricKey = 'desert012' | 'u5Deficit' | 'newFacilities' | 'expansions'

const METRIC_LABELS: Record<MetricKey, string> = {
  desert012: 'Desert (0-12)',
  u5Deficit: 'U5 deficit',
  newFacilities: 'New facilities (#)',
  expansions: 'Expanded facilities (#)',
}

interface Model2Zip {
  zipcode: string
  isHighDemand: boolean
  isDesert: boolean
  u5Deficit: boolean
  totalGap?: number
  u5Gap?: number
  nExpanded?: number
  nNewFacilities?: number
  slotsFromExpansion?: number
  slotsFromNew?: number
  totalSlots?: number
  under5Slots?: number
  minTotalSlots?: number
  minU5Slots?: number
}

interface NewFacilityPoint {
  zipcode: string
  lat: number
  lon: number
  size: string
}

function getZipFromFeature(feature: Feature): string | undefined {
  const p = feature.properties ?? {}
  const raw = p['postalCode'] ?? p['ZIPCODE'] ?? p['zipcode'] ?? p['ZIP']
  if (!raw) return undefined
  return String(raw).padStart(5, '0')
}

function parseZip(row: CsvRow): Model2Zip {
  return {
    zipcode: normalizeZip(row.zipcode),
    isHighDemand: bool(row, 'is_high_demand'),
    isDesert: bool(row, 'is_desert'),
    u5Deficit: bool(row, 'u5_deficit'),
    totalGap: num(row, 'total_gap'),
    u5Gap: num(row, 'u5_gap'),
    nExpanded: num(row, 'n_expanded'),
    nNewFacilities: num(row, 'n_new_facilities'),
    slotsFromExpansion: num(row, 'slots_from_expansion'),
    slotsFromNew: num(row, 'slots_from_new'),
    totalSlots: num(row, 'total_slots'),
    under5Slots: num(row, 'under5_slots'),
    minTotalSlots: num(row, 'min_total_slots'),
    minU5Slots: num(row, 'min_u5_slots'),
  }
}

function parsePoint(row: CsvRow): NewFacilityPoint | null {
  const lat = num(row, 'latitude')
  const lon = num(row, 'longitude')
  if (lat == null || lon == null) return null
  return {
    zipcode: normalizeZip(row.zipcode),
    lat,
    lon,
    size: row.size ?? '',
  }
}

function metricValue(zip: Model2Zip | undefined, metric: MetricKey): number | undefined {
  if (!zip) return undefined
  switch (metric) {
    case 'desert012':
      return zip.isDesert ? 1 : 0
    case 'u5Deficit':
      return zip.u5Deficit ? 1 : 0
    case 'newFacilities':
      return zip.nNewFacilities
    case 'expansions':
      return zip.nExpanded
  }
}

function fmt(v: number | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

function color(v: number | undefined, metric: MetricKey, maxVal: number): string {
  if (v == null || !Number.isFinite(v)) return '#e0e0e0'
  if (metric === 'desert012' || metric === 'u5Deficit') return v >= 1 ? '#de2d26' : '#2ca25f'
  const r = maxVal > 0 ? v / maxVal : 0
  if (r < 0.2) return '#edf8fb'
  if (r < 0.4) return '#b2e2e2'
  if (r < 0.6) return '#66c2a4'
  if (r < 0.8) return '#2ca25f'
  return '#006d2c'
}

const BASE: PathOptions = { weight: 1.3, color: '#444', fillOpacity: 0.7, fillColor: '#e0e0e0' }
const HOVER: PathOptions = { weight: 3, color: '#111', fillOpacity: 0.9 }

export function Model2View() {
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [zipData, setZipData] = useState<Record<string, Model2Zip> | null>(null)
  const [newFacilities, setNewFacilities] = useState<NewFacilityPoint[]>([])
  const [expandedCount, setExpandedCount] = useState(0)
  const [metric, setMetric] = useState<MetricKey>('desert012')
  const [showNewMarkers, setShowNewMarkers] = useState(true)
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/nyc_zipcodes.geojson').then((r) => r.json() as Promise<FeatureCollection>),
      fetchCsv('/m2_zip_summary.csv'),
      fetchCsv('/m2_new_facilities.csv'),
      fetchCsv('/m2_expansions.csv'),
    ]).then(([geo, zipRows, newRows, expRows]) => {
      const z: Record<string, Model2Zip> = {}
      for (const row of zipRows) {
        const parsed = parseZip(row)
        if (parsed.zipcode) z[parsed.zipcode] = parsed
      }
      const points = newRows.map(parsePoint).filter((p): p is NewFacilityPoint => p !== null)
      setGeoJson(geo)
      setZipData(z)
      setNewFacilities(points)
      setExpandedCount(expRows.length)
      setLoading(false)
    })
  }, [])

  const maxMetric = useMemo(() => {
    if (!zipData) return 0
    const values = Object.values(zipData).map((z) => metricValue(z, metric) ?? 0)
    return values.length ? Math.max(...values) : 0
  }, [zipData, metric])

  const summary = useMemo(() => {
    if (!zipData) return null
    const rows = Object.values(zipData)
    const deserts = rows.filter((r) => r.isDesert).length
    const u5def = rows.filter((r) => r.u5Deficit).length
    const totalNew = rows.reduce((a, r) => a + (r.nNewFacilities ?? 0), 0)
    const totalExpanded = rows.reduce((a, r) => a + (r.nExpanded ?? 0), 0)
    return { deserts, u5def, totalNew, totalExpanded }
  }, [zipData])

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip || !zipData) return
      const row = zipData[zip]
      const v = metricValue(row, metric)
      const c = color(v, metric, maxMetric)

      const interactive = layer as Layer & {
        setStyle?: (style: PathOptions) => void
        bindTooltip?: (content: string, options?: { sticky?: boolean }) => void
      }
      interactive.setStyle?.({ ...BASE, fillColor: c })
      interactive.bindTooltip?.(
        row
          ? `<b>ZIP ${zip}</b><br/>${METRIC_LABELS[metric]}: ${fmt(v)}`
          : `<b>ZIP ${zip}</b><br/>No Model2 summary row`,
        { sticky: true },
      )
      layer.on({
        mouseover: (e: LeafletMouseEvent) =>
          (e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle(HOVER),
        mouseout: (e: LeafletMouseEvent) =>
          (e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle({
            ...BASE,
            fillColor: c,
          }),
        click: () => setSelectedZip(zip),
      })
    },
    [zipData, metric, maxMetric],
  )

  if (loading) return <p style={{ padding: 24 }}>Loading Model2 map...</p>
  if (!geoJson || !zipData) return <p style={{ padding: 24 }}>Could not load Model2 data.</p>

  const selected = selectedZip ? zipData[selectedZip] : undefined

  return (
    <div className="map-layout">
      <div className="map-pane">
        <div className="map-controls">
          <label htmlFor="m2-metric">Model2 metric: </label>
          <select id="m2-metric" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
              <option key={k} value={k}>{METRIC_LABELS[k]}</option>
            ))}
          </select>
          <label style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={showNewMarkers} onChange={(e) => setShowNewMarkers(e.target.checked)} />
            {' '}Show new facilities
          </label>
        </div>
        <MapContainer center={[40.7128, -74.006]} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; <a href="https://openstreetmap.org">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <GeoJSON key={metric} data={geoJson} onEachFeature={onEachFeature} />
          {showNewMarkers &&
            newFacilities.slice(0, 3000).map((p, idx) => (
              <CircleMarker
                key={`${p.zipcode}-${idx}`}
                center={[p.lat, p.lon]}
                radius={2}
                pathOptions={{ color: '#4c78a8', fillColor: '#4c78a8', fillOpacity: 0.8 }}
              >
                <Tooltip>New facility {p.size} - ZIP {p.zipcode}</Tooltip>
              </CircleMarker>
            ))}
        </MapContainer>
      </div>

      <aside className="map-info">
        <h3>Model2 - Optimization map</h3>
        {summary && (
          <div className="legend-box">
            <p className="legend-title">Global summary</p>
            <p>Desert zipcodes: {summary.deserts}</p>
            <p>U5 deficit zipcodes: {summary.u5def}</p>
            <p>New facilities: {summary.totalNew}</p>
            <p>Expanded facilities: {summary.totalExpanded}</p>
            <p>Expansion records file rows: {expandedCount}</p>
          </div>
        )}

        {selectedZip ? (
          <div className="info-card">
            <p><strong>ZIP:</strong> {selectedZip}</p>
            {selected ? (
              <>
                <p><strong>Demand class:</strong> {selected.isHighDemand ? 'High' : 'Low'}</p>
                <p><strong>Desert (0-12):</strong> {selected.isDesert ? 'Yes' : 'No'}</p>
                <p><strong>U5 deficit:</strong> {selected.u5Deficit ? 'Yes' : 'No'}</p>
                <hr />
                <p><strong>Total slots / target:</strong> {fmt(selected.totalSlots)} / {fmt(selected.minTotalSlots)}</p>
                <p><strong>U5 slots / target:</strong> {fmt(selected.under5Slots)} / {fmt(selected.minU5Slots)}</p>
                <p><strong>Total gap:</strong> {fmt(selected.totalGap)}</p>
                <p><strong>U5 gap:</strong> {fmt(selected.u5Gap)}</p>
                <hr />
                <p><strong>Expanded facilities:</strong> {fmt(selected.nExpanded)}</p>
                <p><strong>Slots from expansion:</strong> {fmt(selected.slotsFromExpansion, 1)}</p>
                <p><strong>New facilities:</strong> {fmt(selected.nNewFacilities)}</p>
                <p><strong>Slots from new:</strong> {fmt(selected.slotsFromNew)}</p>
              </>
            ) : (
              <p className="hint">No row in `m2_zip_summary.csv` for this zipcode.</p>
            )}
          </div>
        ) : (
          <p className="hint">Hover/click a zipcode to inspect Model2 outputs.</p>
        )}
      </aside>
    </div>
  )
}

