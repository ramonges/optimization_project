import { useCallback, useEffect, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { bool, fetchCsv, normalizeZip, num, type CsvRow } from '../utils/csv'

type MetricKey = 'demandClass' | 'desert012' | 'desert05'

const METRIC_LABELS: Record<MetricKey, string> = {
  demandClass: 'Demand Class',
  desert012: 'Desert Status (0-12)',
  desert05: 'Desert Status (0-5)',
}

interface ZipParams {
  zipcode: string
  pop0to5?: number
  pop0to12?: number
  avgIncome?: number
  employmentRate?: number
  numFacilities?: number
  totalSlots?: number
  under5Slots?: number
  numCandidateSites?: number
  isHighDemand: boolean
  isDesert: boolean
  u5Deficit: boolean
  totalGap?: number
  u5Gap?: number
}

function parseZipParams(row: CsvRow): ZipParams {
  return {
    zipcode: normalizeZip(row.zipcode),
    pop0to5: num(row, 'pop_0_5'),
    pop0to12: num(row, 'pop_0_12'),
    avgIncome: num(row, 'avg_income'),
    employmentRate: num(row, 'employment_rate'),
    numFacilities: num(row, 'num_facilities'),
    totalSlots: num(row, 'total_slots'),
    under5Slots: num(row, 'under5_slots'),
    numCandidateSites: num(row, 'num_candidate_sites'),
    isHighDemand: bool(row, 'is_high_demand'),
    isDesert: bool(row, 'is_desert'),
    u5Deficit: bool(row, 'u5_deficit'),
    totalGap: num(row, 'total_gap'),
    u5Gap: num(row, 'u5_gap'),
  }
}

function getZipFromFeature(feature: Feature): string | undefined {
  const p = feature.properties ?? {}
  const raw = p['postalCode'] ?? p['ZIPCODE'] ?? p['zipcode'] ?? p['ZIP']
  if (!raw) return undefined
  return String(raw).padStart(5, '0')
}

function getMetricValue(stats: ZipParams | undefined, metric: MetricKey): number | undefined {
  if (!stats) return undefined
  switch (metric) {
    case 'demandClass':
      return stats.isHighDemand ? 1 : 0
    case 'desert012':
      return stats.isDesert ? 1 : 0
    case 'desert05':
      return stats.u5Deficit ? 1 : 0
  }
}

function legendRows(metric: MetricKey): Array<{ color: string; label: string }> {
  if (metric === 'demandClass') {
    return [
      { color: '#2b8cbe', label: 'Low demand' },
      { color: '#de2d26', label: 'High demand' },
    ]
  }
  if (metric === 'desert012') {
    return [
      { color: '#2ca25f', label: 'Not desert (0-12)' },
      { color: '#de2d26', label: 'Desert (0-12)' },
    ]
  }
  return [
    { color: '#2ca25f', label: 'No deficit (0-5)' },
    { color: '#de2d26', label: 'Deficit (0-5)' },
  ]
}

function colorFor(value: number | undefined, metric: MetricKey): string {
  if (value == null || !Number.isFinite(value)) return '#e0e0e0'
  if (metric === 'demandClass') return value >= 1 ? '#de2d26' : '#2b8cbe'
  return value >= 1 ? '#de2d26' : '#2ca25f'
}

function fmt(n: number | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function tooltipHtml(zip: string, stats: ZipParams | undefined): string {
  if (!stats) return `<b>ZIP ${zip}</b><br/>No row in zipcode_params_final.csv`
  return `
    <div style="font-size:13px;line-height:1.5">
      <b>ZIP ${zip}</b><br/>
      ${stats.isHighDemand ? 'High demand' : 'Low demand'}<br/>
      ${stats.isDesert ? 'Desert (0-12)' : 'Not desert (0-12)'}<br/>
      ${stats.u5Deficit ? 'Deficit (0-5)' : 'No deficit (0-5)'}<br/>
      Children 0-12: ${fmt(stats.pop0to12)}<br/>
      Total slots: ${fmt(stats.totalSlots)}
    </div>`
}

const DEFAULT_STYLE: PathOptions = {
  weight: 1.4,
  color: '#444',
  fillOpacity: 0.65,
  fillColor: '#e0e0e0',
}

const HIGHLIGHT_STYLE: PathOptions = {
  weight: 3,
  color: '#111',
  fillOpacity: 0.9,
}

export function MapNewYorkViewContainer() {
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [zipData, setZipData] = useState<Record<string, ZipParams> | null>(null)
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('demandClass')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/nyc_zipcodes.geojson').then((r) => r.json() as Promise<FeatureCollection>),
      fetchCsv('/zipcode_params_final.csv'),
    ]).then(([geo, rows]) => {
      const map: Record<string, ZipParams> = {}
      for (const row of rows) {
        const parsed = parseZipParams(row)
        if (parsed.zipcode) map[parsed.zipcode] = parsed
      }
      setGeoJson(geo)
      setZipData(map)
      setLoading(false)
    })
  }, [])

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip) return
      const stats = zipData?.[zip]
      const value = getMetricValue(stats, metric)
      const color = colorFor(value, metric)

      const interactive = layer as Layer & {
        setStyle?: (style: PathOptions) => void
        bindTooltip?: (content: string, options?: { sticky?: boolean }) => void
      }
      interactive.setStyle?.({ ...DEFAULT_STYLE, fillColor: color })
      interactive.bindTooltip?.(tooltipHtml(zip, stats), { sticky: true })

      layer.on({
        mouseover: (e: LeafletMouseEvent) => {
          ;(e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle(HIGHLIGHT_STYLE)
        },
        mouseout: (e: LeafletMouseEvent) => {
          ;(e.target as Layer & { setStyle: (s: PathOptions) => void }).setStyle({
            ...DEFAULT_STYLE,
            fillColor: color,
          })
        },
        click: () => setSelectedZip(zip),
      })
    },
    [zipData, metric],
  )

  if (loading) return <p style={{ padding: 24 }}>Loading map data...</p>
  if (!geoJson || !zipData) return <p style={{ padding: 24 }}>Could not load data.</p>

  const selected = selectedZip ? zipData[selectedZip] : undefined

  return (
    <div className="map-layout">
      <div className="map-pane">
        <div className="map-controls">
          <label htmlFor="metric-select">Color by: </label>
          <select
            id="metric-select"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
          >
            {(Object.keys(METRIC_LABELS) as MetricKey[]).map((k) => (
              <option value={k} key={k}>
                {METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <MapContainer center={[40.7128, -74.006]} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <GeoJSON key={metric} data={geoJson} onEachFeature={onEachFeature} />
        </MapContainer>
      </div>
      <aside className="map-info">
        <h3>Map New York - ZIP details</h3>
        <div className="legend-box">
          <p className="legend-title">Legend - {METRIC_LABELS[metric]}</p>
          {legendRows(metric).map((row) => (
            <div className="legend-row" key={row.label}>
              <span className="legend-swatch" style={{ background: row.color }} />
              <span>{row.label}</span>
            </div>
          ))}
        </div>

        {selectedZip ? (
          <div className="info-card">
            <p><strong>ZIP:</strong> {selectedZip}</p>
            {selected ? (
              <>
                <p style={{ marginTop: 8, fontWeight: 600 }}>
                  {selected.isHighDemand ? 'High demand' : 'Low demand'} /{' '}
                  {selected.isDesert ? 'Desert (0-12)' : 'Not desert (0-12)'} /{' '}
                  {selected.u5Deficit ? 'Deficit (0-5)' : 'No deficit (0-5)'}
                </p>
                <hr />
                <p><strong>Children 0-5:</strong> {fmt(selected.pop0to5)}</p>
                <p><strong>Children 0-12:</strong> {fmt(selected.pop0to12)}</p>
                <p><strong>Avg income:</strong> ${fmt(selected.avgIncome)}</p>
                <p><strong>Employment rate:</strong> {selected.employmentRate != null ? fmt(selected.employmentRate * 100, 1) + '%' : 'N/A'}</p>
                <hr />
                <p><strong>Facilities:</strong> {fmt(selected.numFacilities)}</p>
                <p><strong>Total slots:</strong> {fmt(selected.totalSlots)}</p>
                <p><strong>Under-5 slots:</strong> {fmt(selected.under5Slots)}</p>
                <p><strong>Candidate sites:</strong> {fmt(selected.numCandidateSites)}</p>
                <p><strong>Total gap:</strong> {fmt(selected.totalGap)}</p>
                <p><strong>Under-5 gap:</strong> {fmt(selected.u5Gap)}</p>
              </>
            ) : (
              <p className="hint">This zipcode has no row in `zipcode_params_final.csv`.</p>
            )}
          </div>
        ) : (
          <p className="hint">Hover a zipcode for summary. Click a zipcode to pin details.</p>
        )}
      </aside>
    </div>
  )
}

