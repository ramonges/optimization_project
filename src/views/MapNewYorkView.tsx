import { useCallback, useEffect, useMemo, useState } from 'react'
import { GeoJSON, MapContainer, TileLayer } from 'react-leaflet'
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
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

type NumericField =
  | 'pop0to5'
  | 'pop0to12'
  | 'avgIncome'
  | 'employmentRate'
  | 'numFacilities'
  | 'totalSlots'
  | 'under5Slots'
  | 'numCandidateSites'
  | 'totalGap'
  | 'u5Gap'

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

function roundCoord(v: number): string {
  return v.toFixed(5)
}

function extractVertexKeys(geometry: Geometry): Set<string> {
  const vertices = new Set<string>()
  const addPos = (pos: Position) => {
    if (pos.length < 2) return
    vertices.add(`${roundCoord(pos[0])},${roundCoord(pos[1])}`)
  }

  if (geometry.type === 'Polygon') {
    for (const ring of geometry.coordinates) {
      for (const pos of ring) addPos(pos)
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      for (const ring of polygon) {
        for (const pos of ring) addPos(pos)
      }
    }
  }
  return vertices
}

function buildNeighborMap(geoJson: FeatureCollection): Record<string, Set<string>> {
  const vertexToZips = new Map<string, Set<string>>()
  const neighbors: Record<string, Set<string>> = {}

  for (const feature of geoJson.features) {
    const zip = getZipFromFeature(feature)
    if (!zip || !feature.geometry) continue
    neighbors[zip] = neighbors[zip] ?? new Set<string>()
    const vertices = extractVertexKeys(feature.geometry)
    for (const v of vertices) {
      const zips = vertexToZips.get(v) ?? new Set<string>()
      zips.add(zip)
      vertexToZips.set(v, zips)
    }
  }

  for (const zips of vertexToZips.values()) {
    const arr = Array.from(zips)
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        neighbors[arr[i]].add(arr[j])
        neighbors[arr[j]].add(arr[i])
      }
    }
  }
  return neighbors
}

function deriveDemandFlags(z: ZipParams): Pick<ZipParams, 'isHighDemand' | 'isDesert' | 'u5Deficit'> {
  const emp = z.employmentRate
  const inc = z.avgIncome
  const pop012 = z.pop0to12 ?? 0
  const pop05 = z.pop0to5 ?? 0
  const slots = z.totalSlots ?? 0
  const slots05 = z.under5Slots ?? 0

  const isHighDemand =
    emp == null || inc == null ? true : emp >= 0.6 || inc <= 60000
  const threshold = isHighDemand ? 0.5 : 1 / 3
  const isDesert = pop012 > 0 ? slots <= threshold * pop012 : false
  const u5Deficit = pop05 > 0 ? slots05 < (2 / 3) * pop05 : false
  return { isHighDemand, isDesert, u5Deficit }
}

function imputeMissingZipcodesByNeighbors(
  base: Record<string, ZipParams>,
  geoJson: FeatureCollection,
): { data: Record<string, ZipParams>; imputedZips: Set<string> } {
  const data: Record<string, ZipParams> = { ...base }
  const imputedZips = new Set<string>()
  const neighbors = buildNeighborMap(geoJson)
  const fields: NumericField[] = [
    'pop0to5',
    'pop0to12',
    'avgIncome',
    'employmentRate',
    'numFacilities',
    'totalSlots',
    'under5Slots',
    'numCandidateSites',
    'totalGap',
    'u5Gap',
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const zip of Object.keys(neighbors)) {
      if (data[zip]) continue
      const ns = Array.from(neighbors[zip]).filter((n) => !!data[n])
      if (ns.length === 0) continue

      const imputed: ZipParams = {
        zipcode: zip,
        isHighDemand: true,
        isDesert: false,
        u5Deficit: false,
      }

      let hasAny = false
      for (const f of fields) {
        const vals = ns
          .map((n) => data[n][f])
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        if (!vals.length) continue
        imputed[f] = vals.reduce((a, b) => a + b, 0) / vals.length
        hasAny = true
      }

      if (hasAny) {
        Object.assign(imputed, deriveDemandFlags(imputed))
        data[zip] = imputed
        imputedZips.add(zip)
        changed = true
      }
    }
  }

  return { data, imputedZips }
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

function tooltipHtml(zip: string, stats: ZipParams | undefined, imputed: boolean): string {
  if (!stats) return `<b>ZIP ${zip}</b><br/>No dataset row for this zipcode`
  const estimation = imputed
    ? `<span style="color:#7f8c8d">Estimated from neighboring zipcodes</span><br/>`
    : ''
  return `
    <div style="font-size:13px;line-height:1.5">
      <b>ZIP ${zip}</b><br/>
      ${estimation}
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

  const { resolvedData, imputedZips } = useMemo(() => {
    if (!zipData || !geoJson) return { resolvedData: zipData, imputedZips: new Set<string>() }
    const out = imputeMissingZipcodesByNeighbors(zipData, geoJson)
    return { resolvedData: out.data, imputedZips: out.imputedZips }
  }, [zipData, geoJson])

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip) return
      const stats = resolvedData?.[zip]
      const isImputed = imputedZips.has(zip)
      const value = getMetricValue(stats, metric)
      const color = colorFor(value, metric)

      const interactive = layer as Layer & {
        setStyle?: (style: PathOptions) => void
        bindTooltip?: (content: string, options?: { sticky?: boolean }) => void
      }
      interactive.setStyle?.({ ...DEFAULT_STYLE, fillColor: color })
      interactive.bindTooltip?.(tooltipHtml(zip, stats, isImputed), { sticky: true })

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
    [resolvedData, metric, imputedZips],
  )

  if (loading) return <p style={{ padding: 24 }}>Loading map data...</p>
  if (!geoJson || !resolvedData) return <p style={{ padding: 24 }}>Could not load data.</p>

  const selected = selectedZip ? resolvedData[selectedZip] : undefined
  const selectedImputed = selectedZip ? imputedZips.has(selectedZip) : false

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
                {selectedImputed && (
                  <p className="hint" style={{ marginTop: 8 }}>
                    Estimated from neighboring zipcodes (limitrophes).
                  </p>
                )}
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
              <p className="hint">No direct row and no neighboring values available for estimation.</p>
            )}
          </div>
        ) : (
          <p className="hint">Hover a zipcode for summary. Click a zipcode to pin details.</p>
        )}
      </aside>
    </div>
  )
}

