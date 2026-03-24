import { useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import { bool, fetchCsv, normalizeZip, num, type CsvRow } from '../utils/csv'

type MetricKey = 'objective' | 'newFacilities' | 'newSlots' | 'expansionSlots'

interface Model1Zip {
  zipcode: string
  status: string
  objective?: number
  expansionSlots?: number
  newSmall?: number
  newMedium?: number
  newLarge?: number
  newTotalSlots?: number
  totalGap?: number
  u5Gap?: number
  isHighDemand?: boolean
  isDesert?: boolean
}

const METRIC_LABELS: Record<MetricKey, string> = {
  objective: 'Objective cost ($)',
  newFacilities: 'New facilities (#)',
  newSlots: 'New total slots',
  expansionSlots: 'Expansion slots',
}

function getZipFromFeature(feature: Feature): string | undefined {
  const p = feature.properties ?? {}
  const raw = p['postalCode'] ?? p['ZIPCODE'] ?? p['zipcode'] ?? p['ZIP']
  if (!raw) return undefined
  return String(raw).padStart(5, '0')
}

function parseModel1Row(row: CsvRow): Model1Zip {
  return {
    zipcode: normalizeZip(row.zipcode),
    status: row.status ?? '',
    objective: num(row, 'objective_value'),
    expansionSlots: num(row, 'expansion_slots'),
    newSmall: num(row, 'new_small'),
    newMedium: num(row, 'new_medium'),
    newLarge: num(row, 'new_large'),
    newTotalSlots: num(row, 'new_total_slots'),
    totalGap: num(row, 'total_gap'),
    u5Gap: num(row, 'u5_gap'),
    isHighDemand: bool(row, 'is_high_demand'),
    isDesert: bool(row, 'is_desert'),
  }
}

function metricValue(m: Model1Zip, metric: MetricKey): number | undefined {
  switch (metric) {
    case 'objective':
      return m.objective
    case 'newFacilities':
      return (m.newSmall ?? 0) + (m.newMedium ?? 0) + (m.newLarge ?? 0)
    case 'newSlots':
      return m.newTotalSlots
    case 'expansionSlots':
      return m.expansionSlots
  }
}

function fmt(v: number | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })
}

function colorByValue(v: number | undefined, max: number): string {
  if (v == null || !Number.isFinite(v)) return '#e0e0e0'
  const r = max > 0 ? v / max : 0
  if (r < 0.2) return '#edf8fb'
  if (r < 0.4) return '#b2e2e2'
  if (r < 0.6) return '#66c2a4'
  if (r < 0.8) return '#2ca25f'
  return '#006d2c'
}

const BASE_STYLE: PathOptions = { weight: 1.3, color: '#444', fillOpacity: 0.7, fillColor: '#e0e0e0' }
const HOVER_STYLE: PathOptions = { weight: 3, color: '#111', fillOpacity: 0.9 }

export function Model1View() {
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [data, setData] = useState<Record<string, Model1Zip> | null>(null)
  const [rawByZip, setRawByZip] = useState<Record<string, CsvRow> | null>(null)
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('objective')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/nyc_zipcodes.geojson').then((r) => r.json() as Promise<FeatureCollection>),
      fetchCsv('/model1_results_final.csv'),
    ]).then(([geo, rows]) => {
      const map: Record<string, Model1Zip> = {}
      const rawMap: Record<string, CsvRow> = {}
      for (const row of rows) {
        const parsed = parseModel1Row(row)
        if (parsed.zipcode) {
          map[parsed.zipcode] = parsed
          rawMap[parsed.zipcode] = row
        }
      }
      setGeoJson(geo)
      setData(map)
      setRawByZip(rawMap)
      setLoading(false)
    })
  }, [])

  const maxMetric = useMemo(() => {
    if (!data) return 0
    const values = Object.values(data)
      .map((z) => metricValue(z, metric) ?? 0)
      .filter((v) => Number.isFinite(v))
    return values.length ? Math.max(...values) : 0
  }, [data, metric])

  const summary = useMemo(() => {
    if (!data) return null
    const rows = Object.values(data)
    const totalBudget = rows.reduce((a, r) => a + (r.objective ?? 0), 0)
    const totalNewFacilities = rows.reduce(
      (a, r) => a + (r.newSmall ?? 0) + (r.newMedium ?? 0) + (r.newLarge ?? 0),
      0,
    )
    const totalExpansion = rows.reduce((a, r) => a + (r.expansionSlots ?? 0), 0)
    return { totalBudget, totalNewFacilities, totalExpansion }
  }, [data])

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip || !data) return
      const row = data[zip]
      const raw = rawByZip?.[zip]
      const val = row ? metricValue(row, metric) : undefined
      const color = colorByValue(val, maxMetric)

      const interactive = layer as Layer & {
        setStyle?: (style: PathOptions) => void
        bindTooltip?: (content: string, options?: { sticky?: boolean }) => void
      }
      const allFieldsHtml = raw
        ? Object.entries(raw)
            .map(([k, v]) => `<div><strong>${k}:</strong> ${v === '' ? 'N/A' : v}</div>`)
            .join('')
        : ''

      interactive.setStyle?.({ ...BASE_STYLE, fillColor: color })
      interactive.bindTooltip?.(
        row
          ? `<div style="max-height:260px;overflow:auto;font-size:12px;line-height:1.4"><b>ZIP ${zip}</b><br/>${METRIC_LABELS[metric]}: ${fmt(val)}<br/>Status: ${row.status}<hr style="margin:4px 0"/>${allFieldsHtml}</div>`
          : `<b>ZIP ${zip}</b><br/>No Model1 result row`,
        { sticky: true },
      )

      layer.on({
        mouseover: (e: LeafletMouseEvent) =>
          (e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle(HOVER_STYLE),
        mouseout: (e: LeafletMouseEvent) =>
          (e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle({
            ...BASE_STYLE,
            fillColor: color,
          }),
        click: () => setSelectedZip(zip),
      })
    },
    [data, rawByZip, metric, maxMetric],
  )

  if (loading) return <p style={{ padding: 24 }}>Loading Model1 map...</p>
  if (!geoJson || !data || !rawByZip) return <p style={{ padding: 24 }}>Could not load Model1 data.</p>

  const selected = selectedZip ? data[selectedZip] : undefined
  const selectedRaw = selectedZip ? rawByZip[selectedZip] : undefined

  return (
    <div className="map-layout">
      <div className="map-pane">
        <div className="map-controls">
          <label htmlFor="m1-metric">Model1 metric: </label>
          <select id="m1-metric" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
              <option key={k} value={k}>{METRIC_LABELS[k]}</option>
            ))}
          </select>
        </div>
        <MapContainer center={[40.7128, -74.006]} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; <a href="https://openstreetmap.org">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <GeoJSON key={metric} data={geoJson} onEachFeature={onEachFeature} />
        </MapContainer>
      </div>

      <aside className="map-info">
        <h3>Model1 - Optimization map</h3>
        {summary && (
          <div className="legend-box">
            <p className="legend-title">Global summary</p>
            <p>Total budget: ${fmt(summary.totalBudget)}</p>
            <p>New facilities: {fmt(summary.totalNewFacilities)}</p>
            <p>Expansion slots: {fmt(summary.totalExpansion)}</p>
          </div>
        )}
        {selectedZip ? (
          <div className="info-card">
            <p><strong>ZIP:</strong> {selectedZip}</p>
            {selected ? (
              <>
                <p><strong>Status:</strong> {selected.status}</p>
                <p><strong>Demand class:</strong> {selected.isHighDemand ? 'High' : 'Low'}</p>
                <p><strong>Initial desert:</strong> {selected.isDesert ? 'Yes' : 'No'}</p>
                <hr />
                <p><strong>Objective cost:</strong> ${fmt(selected.objective)}</p>
                <p><strong>Expansion slots:</strong> {fmt(selected.expansionSlots, 1)}</p>
                <p><strong>New small:</strong> {fmt(selected.newSmall)}</p>
                <p><strong>New medium:</strong> {fmt(selected.newMedium)}</p>
                <p><strong>New large:</strong> {fmt(selected.newLarge)}</p>
                <p><strong>New total slots:</strong> {fmt(selected.newTotalSlots)}</p>
                <hr />
                <p><strong>Total gap:</strong> {fmt(selected.totalGap)}</p>
                <p><strong>U5 gap:</strong> {fmt(selected.u5Gap)}</p>
                {selectedRaw && (
                  <>
                    <hr />
                    <p><strong>All CSV fields:</strong></p>
                    <div className="raw-kv-list">
                      {Object.entries(selectedRaw).map(([k, v]) => (
                        <p key={k}><strong>{k}:</strong> {v === '' ? 'N/A' : v}</p>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="hint">No row in `model1_results_final.csv` for this zipcode.</p>
            )}
          </div>
        ) : (
          <p className="hint">Hover/click a zipcode to inspect Model1 decision outputs.</p>
        )}
      </aside>
    </div>
  )
}

