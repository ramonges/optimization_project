import { useEffect, useState, useCallback, useMemo } from 'react'
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet'
import type { FeatureCollection, Feature, Geometry, Position } from 'geojson'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { loadZipData, type ZipCodeStats } from '../utils/zipData'
import { classifyZipcode, type DesertStatus } from '../utils/desertCriteria'

type MetricKey =
  | 'demandClass'
  | 'avgIncome'
  | 'employmentRate'
  | 'totalPopulation'
  | 'children0to12'
  | 'existingSlots'
  | 'desertStatus'

const METRIC_LABELS: Record<MetricKey, string> = {
  demandClass: 'Demand Class',
  avgIncome: 'Average Income ($)',
  employmentRate: 'Employment Rate (%)',
  totalPopulation: 'Total Population',
  children0to12: 'Children 0-12',
  existingSlots: 'Child Care Slots',
  desertStatus: 'Child Care Desert',
}

function legendRows(metric: MetricKey): Array<{ color: string; label: string }> {
  if (metric === 'demandClass') {
    return [
      { color: '#2b8cbe', label: 'Low demand' },
      { color: '#de2d26', label: 'High demand' },
    ]
  }
  if (metric === 'desertStatus') {
    return [
      { color: '#2ca25f', label: 'Not desert' },
      { color: '#fee391', label: 'Desert 0-5 only' },
      { color: '#fc9272', label: 'Desert 0-12 only' },
      { color: '#de2d26', label: 'Desert 0-12 and 0-5' },
    ]
  }
  if (metric === 'avgIncome') {
    return [
      { color: '#fee5d9', label: '< $40k' },
      { color: '#fcbba1', label: '$40k-$60k' },
      { color: '#fc9272', label: '$60k-$80k' },
      { color: '#fb6a4a', label: '$80k-$100k' },
      { color: '#de2d26', label: '$100k-$120k' },
      { color: '#a50f15', label: '> $120k' },
    ]
  }
  if (metric === 'employmentRate') {
    return [
      { color: '#fee5d9', label: '< 40%' },
      { color: '#fcbba1', label: '40%-50%' },
      { color: '#fc9272', label: '50%-55%' },
      { color: '#fb6a4a', label: '55%-60%' },
      { color: '#de2d26', label: '60%-70%' },
      { color: '#a50f15', label: '> 70%' },
    ]
  }
  return [
    { color: '#eff3ff', label: 'Low' },
    { color: '#bdd7e7', label: 'Lower-mid' },
    { color: '#6baed6', label: 'Mid' },
    { color: '#3182bd', label: 'Upper-mid' },
    { color: '#08519c', label: 'High' },
  ]
}

function getZipFromFeature(feature: Feature): string | undefined {
  const p = feature.properties ?? {}
  const raw = p['postalCode'] ?? p['ZIPCODE'] ?? p['zipcode'] ?? p['ZIP']
  if (!raw) return undefined
  return String(raw).padStart(5, '0')
}

function getMetricValue(
  stats: ZipCodeStats | undefined,
  desert: DesertStatus | undefined,
  metric: MetricKey,
): number | undefined {
  if (!stats) return undefined
  switch (metric) {
    case 'demandClass':
      if (!desert) return undefined
      return desert.isHighDemand ? 1 : 0
    case 'avgIncome':
      return stats.avgIncome
    case 'employmentRate':
      return stats.employmentRate != null ? stats.employmentRate * 100 : undefined
    case 'totalPopulation':
      return stats.totalPopulation
    case 'children0to12':
      return stats.totalChildren0to12
    case 'existingSlots':
      return stats.existingSlotsTotal
    case 'desertStatus':
      if (!desert) return undefined
      if (desert.isDesert && desert.isDesert0to5) return 3
      if (desert.isDesert) return 2
      if (desert.isDesert0to5) return 1
      return 0
  }
}

function choroplethColor(value: number | undefined, metric: MetricKey): string {
  if (value == null || !Number.isFinite(value)) return '#e0e0e0'

  if (metric === 'demandClass') {
    return value >= 1 ? '#de2d26' : '#2b8cbe'
  }
  if (metric === 'desertStatus') {
    if (value === 0) return '#2ca25f'
    if (value === 1) return '#fee391'
    if (value === 2) return '#fc9272'
    return '#de2d26'
  }
  if (metric === 'avgIncome') {
    if (value < 40000) return '#fee5d9'
    if (value < 60000) return '#fcbba1'
    if (value < 80000) return '#fc9272'
    if (value < 100000) return '#fb6a4a'
    if (value < 120000) return '#de2d26'
    return '#a50f15'
  }
  if (metric === 'employmentRate') {
    if (value < 40) return '#fee5d9'
    if (value < 50) return '#fcbba1'
    if (value < 55) return '#fc9272'
    if (value < 60) return '#fb6a4a'
    if (value < 70) return '#de2d26'
    return '#a50f15'
  }
  if (value < 5000) return '#eff3ff'
  if (value < 15000) return '#bdd7e7'
  if (value < 30000) return '#6baed6'
  if (value < 50000) return '#3182bd'
  return '#08519c'
}

function fmt(n: number | undefined, decimals = 0): string {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function desertLabel(d: DesertStatus): string {
  const parts: string[] = []
  if (d.isDesert) parts.push('Desert (0-12)')
  if (d.isDesert0to5) parts.push('Desert (0-5)')
  if (parts.length === 0) return 'Not a desert'
  return parts.join(', ')
}

function buildTooltipHtml(
  zip: string,
  stats: ZipCodeStats | undefined,
  desert: DesertStatus | undefined,
  isImputed: boolean,
): string {
  if (!stats)
    return `<b>ZIP ${zip}</b><br/>No source data in provided CSV files`
  const desertTag = desert
    ? `<br/><span style="color:${desert.isDesert || desert.isDesert0to5 ? '#c0392b' : '#27ae60'};font-weight:600">${desertLabel(desert)}</span>`
    : ''
  const imputedTag = isImputed
    ? `<br/><span style="color:#7f8c8d;font-weight:600">Estimated as neighbors average</span>`
    : ''
  return `
    <div style="font-size:13px;line-height:1.6">
      <b>ZIP ${zip}</b>${desertTag}${imputedTag}<br/>
      Population: ${fmt(stats.totalPopulation)}<br/>
      Children 0-5: ${fmt(stats.children0to5)}<br/>
      Children 6-12: ${fmt(stats.children6to12)}<br/>
      Avg Income: $${fmt(stats.avgIncome)}<br/>
      Employment: ${stats.employmentRate != null ? fmt(stats.employmentRate * 100, 1) + '%' : 'N/A'}<br/>
      Child Care Slots: ${fmt(stats.existingSlotsTotal)}<br/>
      Facilities: ${fmt(stats.facilityCount)}
    </div>`
}

const DEFAULT_STYLE: PathOptions = {
  weight: 1.5,
  color: '#444',
  fillOpacity: 0.65,
  fillColor: '#e0e0e0',
}

const HIGHLIGHT_STYLE: PathOptions = {
  weight: 3,
  color: '#222',
  fillOpacity: 0.85,
}

type InteractiveLayer = Layer & {
  setStyle: (style: PathOptions) => void
  bindTooltip: (content: string, options?: { sticky?: boolean }) => void
}

function isInteractiveLayer(layer: Layer): layer is InteractiveLayer {
  return (
    typeof (layer as { setStyle?: unknown }).setStyle === 'function' &&
    typeof (layer as { bindTooltip?: unknown }).bindTooltip === 'function'
  )
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
  const zipVertices = new Map<string, Set<string>>()
  const vertexToZips = new Map<string, Set<string>>()

  for (const feature of geoJson.features) {
    const zip = getZipFromFeature(feature)
    if (!zip || !feature.geometry) continue
    const verts = extractVertexKeys(feature.geometry)
    zipVertices.set(zip, verts)
    for (const v of verts) {
      const set = vertexToZips.get(v) ?? new Set<string>()
      set.add(zip)
      vertexToZips.set(v, set)
    }
  }

  const neighbors: Record<string, Set<string>> = {}
  for (const zip of zipVertices.keys()) neighbors[zip] = new Set<string>()

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

function featureCentroid(geometry: Geometry): [number, number] | null {
  let sumLon = 0
  let sumLat = 0
  let count = 0
  const addPos = (pos: Position) => {
    if (pos.length < 2) return
    sumLon += Number(pos[0])
    sumLat += Number(pos[1])
    count += 1
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

  if (count === 0) return null
  return [sumLon / count, sumLat / count]
}

function buildCentroidMap(geoJson: FeatureCollection): Record<string, [number, number]> {
  const centers: Record<string, [number, number]> = {}
  for (const feature of geoJson.features) {
    const zip = getZipFromFeature(feature)
    if (!zip || !feature.geometry) continue
    const c = featureCentroid(feature.geometry)
    if (c) centers[zip] = c
  }
  return centers
}

function imputeMissingFromNeighbors(
  raw: Record<string, ZipCodeStats>,
  geoJson: FeatureCollection,
): { data: Record<string, ZipCodeStats>; imputed: Set<string> } {
  type NumericZipKey =
    | 'avgIncome'
    | 'employmentRate'
    | 'totalPopulation'
    | 'children0to5'
    | 'children6to12'
    | 'totalChildren0to12'
    | 'existingSlotsTotal'
    | 'existingSlots0to5'
    | 'facilityCount'
    | 'potentialLocationCount'

  const numericKeys: NumericZipKey[] = [
    'avgIncome',
    'employmentRate',
    'totalPopulation',
    'children0to5',
    'children6to12',
    'totalChildren0to12',
    'existingSlotsTotal',
    'existingSlots0to5',
    'facilityCount',
    'potentialLocationCount',
  ]

  const data: Record<string, ZipCodeStats> = { ...raw }
  const imputed = new Set<string>()
  const neighbors = buildNeighborMap(geoJson)
  const centroids = buildCentroidMap(geoJson)

  let changed = true
  while (changed) {
    changed = false
    for (const zip of Object.keys(neighbors)) {
      const ns = Array.from(neighbors[zip]).filter((n) => !!data[n])
      if (ns.length === 0) continue

      const base: ZipCodeStats = data[zip] ? { ...data[zip] } : { zipcode: zip }
      let filledAny = false
      for (const key of numericKeys) {
        if (typeof base[key] === 'number' && Number.isFinite(base[key])) continue
        const vals = ns
          .map((n) => data[n][key])
          .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
        if (vals.length === 0) continue
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length
        base[key] = avg
        filledAny = true
      }

      if (filledAny) {
        data[zip] = base
        imputed.add(zip)
        changed = true
      }
    }
  }

  // Global fallback: for remaining missing fields, use weighted average of nearest zipcodes.
  const dist = (a: [number, number], b: [number, number]) => {
    const dx = a[0] - b[0]
    const dy = a[1] - b[1]
    return Math.sqrt(dx * dx + dy * dy)
  }
  const k = 5
  for (const zip of Object.keys(centroids)) {
    const base: ZipCodeStats = data[zip] ? { ...data[zip] } : { zipcode: zip }
    let filledAny = false

    for (const key of numericKeys) {
      if (typeof base[key] === 'number' && Number.isFinite(base[key])) continue

      const candidates = Object.keys(centroids)
        .filter(
          (z) =>
            z !== zip &&
            !!data[z] &&
            typeof data[z][key] === 'number' &&
            Number.isFinite(data[z][key] as number),
        )
        .map((z) => ({
          zip: z,
          d: dist(centroids[zip], centroids[z]),
          v: data[z][key] as number,
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, k)

      if (candidates.length === 0) continue

      let wSum = 0
      let vSum = 0
      for (const c of candidates) {
        const w = 1 / Math.max(c.d, 1e-6)
        wSum += w
        vSum += w * c.v
      }
      if (wSum > 0) {
        base[key] = vSum / wSum
        filledAny = true
      }
    }

    if (filledAny) {
      data[zip] = base
      imputed.add(zip)
    }
  }

  return { data, imputed }
}

export function MapNewYorkViewContainer() {
  const [zipData, setZipData] = useState<Record<string, ZipCodeStats> | null>(null)
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('demandClass')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      loadZipData(),
      fetch('/nyc_zipcodes.geojson').then((r) => r.json() as Promise<FeatureCollection>),
    ]).then(([data, geo]) => {
      setZipData(data)
      setGeoJson(geo)
      setLoading(false)
    })
  }, [])

  const { resolvedZipData, imputedZips } = useMemo(() => {
    if (!zipData || !geoJson) {
      return { resolvedZipData: zipData, imputedZips: new Set<string>() }
    }
    const out = imputeMissingFromNeighbors(zipData, geoJson)
    return { resolvedZipData: out.data, imputedZips: out.imputed }
  }, [zipData, geoJson])

  const desertMap = resolvedZipData
    ? Object.fromEntries(
        Object.entries(resolvedZipData).map(([z, s]) => [z, classifyZipcode(s)]),
      )
    : null

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip) return
      if (!isInteractiveLayer(layer)) return
      const stats = resolvedZipData?.[zip]
      const desert = desertMap?.[zip]
      const isImputed = imputedZips.has(zip)
      const value = getMetricValue(stats, desert, metric)
      const color = choroplethColor(value, metric)

      layer.setStyle({ ...DEFAULT_STYLE, fillColor: color })
      layer.bindTooltip(buildTooltipHtml(zip, stats, desert, isImputed), { sticky: true })

      layer.on({
        mouseover: (e: LeafletMouseEvent) => {
          e.target.setStyle(HIGHLIGHT_STYLE)
        },
        mouseout: (e: LeafletMouseEvent) => {
          e.target.setStyle({ ...DEFAULT_STYLE, fillColor: color })
        },
        click: () => setSelectedZip(zip),
      })
    },
    [resolvedZipData, desertMap, metric, imputedZips],
  )

  if (loading) return <p style={{ padding: 24 }}>Loading NYC map data...</p>
  if (!geoJson) return <p style={{ padding: 24 }}>Could not load map geometry.</p>

  const selectedStats = selectedZip ? resolvedZipData?.[selectedZip] : undefined
  const selectedDesert = selectedZip && desertMap ? desertMap[selectedZip] : undefined
  const selectedIsImputed = selectedZip ? imputedZips.has(selectedZip) : false

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
              <option key={k} value={k}>
                {METRIC_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <MapContainer
          center={[40.7128, -74.006]}
          zoom={11}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://openstreetmap.org">OSM</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <GeoJSON key={metric} data={geoJson} onEachFeature={onEachFeature} />
        </MapContainer>
      </div>

      <aside className="map-info">
        <h3>Zipcode Details</h3>
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
            {!selectedStats ? (
              <p className="hint" style={{ marginTop: 8 }}>
                This zipcode exists in the map geometry, but no rows were found in your provided
                CSV datasets for this ZIP.
              </p>
            ) : (
              <>
            {selectedIsImputed && (
              <p className="hint" style={{ marginTop: 8 }}>
                Values shown are estimated using the average of neighboring zipcodes.
              </p>
            )}
            {selectedDesert && (
              <p
                style={{
                  color: selectedDesert.isDesert || selectedDesert.isDesert0to5 ? '#c0392b' : '#27ae60',
                  fontWeight: 600,
                }}
              >
                {desertLabel(selectedDesert)}
                {selectedDesert.isHighDemand ? ' (High demand)' : ' (Low demand)'}
              </p>
            )}
            <hr />
            <p><strong>Total Population:</strong> {fmt(selectedStats.totalPopulation)}</p>
            <p><strong>Children 0-5:</strong> {fmt(selectedStats.children0to5)}</p>
            <p><strong>Children 6-12:</strong> {fmt(selectedStats.children6to12)}</p>
            <p><strong>Children 0-12:</strong> {fmt(selectedStats.totalChildren0to12)}</p>
            <hr />
            <p><strong>Average Income:</strong> ${fmt(selectedStats.avgIncome)}</p>
            <p>
              <strong>Employment Rate:</strong>{' '}
              {selectedStats.employmentRate != null
                ? fmt(selectedStats.employmentRate * 100, 1) + '%'
                : 'N/A'}
            </p>
            <hr />
            <p><strong>Total Capacity (slots):</strong> {fmt(selectedStats.existingSlotsTotal)}</p>
            <p><strong>Slots 0-5:</strong> {fmt(selectedStats.existingSlots0to5)}</p>
            <p><strong>Facilities:</strong> {fmt(selectedStats.facilityCount)}</p>
            <p><strong>Potential Locations:</strong> {fmt(selectedStats.potentialLocationCount)}</p>
            {selectedDesert?.slotsPerChild0to12 != null && (
              <p><strong>Slots per child (0-12):</strong> {fmt(selectedDesert.slotsPerChild0to12, 2)}</p>
            )}
            {selectedDesert?.slotsPerChild0to5 != null && (
              <p><strong>Slots per child (0-5):</strong> {fmt(selectedDesert.slotsPerChild0to5, 2)}</p>
            )}
            </>
            )}
          </div>
        ) : (
          <p className="hint">Hover over a zipcode to see a summary. Click to pin details here.</p>
        )}
      </aside>
    </div>
  )
}
