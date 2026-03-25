import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from 'react-leaflet'
import type { Feature, FeatureCollection } from 'geojson'
import type { Layer, LeafletMouseEvent, PathOptions } from 'leaflet'
import { fetchCsv, normalizeZip, num, type CsvRow } from '../utils/csv'

type MetricKey = 'totalCost' | 'slotsFromNew' | 'slotsFromExpansion' | 'newFacilities'

interface Model2Zip {
  zipcode: string
  status: string
  totalCost?: number
  expansionCost?: number
  buildCost?: number
  slotsFromExpansion?: number
  u5FromExpansion?: number
  slotsFromNew?: number
  u5FromNew?: number
  newSmall?: number
  newMedium?: number
  newLarge?: number
  totalGap?: number
  u5Gap?: number
}

interface NewFacilityLocation {
  zipcode: string
  locationId?: string
  size?: string
  latitude?: number
  longitude?: number
}

const METRIC_LABELS: Record<MetricKey, string> = {
  totalCost: 'Total cost ($)',
  slotsFromNew: 'Slots from new facilities',
  slotsFromExpansion: 'Slots from expansion',
  newFacilities: 'New facilities (#)',
}

function getZipFromFeature(feature: Feature): string | undefined {
  const p = feature.properties ?? {}
  const raw = p['postalCode'] ?? p['ZIPCODE'] ?? p['zipcode'] ?? p['ZIP']
  if (!raw) return undefined
  return String(raw).padStart(5, '0')
}

function parseModel2Row(row: CsvRow): Model2Zip {
  return {
    zipcode: normalizeZip(row.zipcode),
    status: row.status ?? '',
    totalCost: num(row, 'total_cost'),
    expansionCost: num(row, 'expansion_cost'),
    buildCost: num(row, 'build_cost'),
    slotsFromExpansion: num(row, 'slots_from_expansion'),
    u5FromExpansion: num(row, 'u5_from_expansion'),
    slotsFromNew: num(row, 'slots_from_new'),
    u5FromNew: num(row, 'u5_from_new'),
    newSmall: num(row, 'new_small'),
    newMedium: num(row, 'new_medium'),
    newLarge: num(row, 'new_large'),
    totalGap: num(row, 'total_gap'),
    u5Gap: num(row, 'u5_gap'),
  }
}

function parseNewFacilityLocation(row: CsvRow): NewFacilityLocation {
  return {
    zipcode: normalizeZip(row.zipcode),
    locationId: row.location_id,
    size: row.size,
    latitude: num(row, 'latitude'),
    longitude: num(row, 'longitude'),
  }
}

function metricValue(r: Model2Zip, metric: MetricKey): number | undefined {
  switch (metric) {
    case 'totalCost':
      return r.totalCost
    case 'slotsFromNew':
      return r.slotsFromNew
    case 'slotsFromExpansion':
      return r.slotsFromExpansion
    case 'newFacilities':
      return (r.newSmall ?? 0) + (r.newMedium ?? 0) + (r.newLarge ?? 0)
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

export function Model2View() {
  const [geoJson, setGeoJson] = useState<FeatureCollection | null>(null)
  const [data, setData] = useState<Record<string, Model2Zip> | null>(null)
  const [rawByZip, setRawByZip] = useState<Record<string, CsvRow> | null>(null)
  const [newLocations, setNewLocations] = useState<NewFacilityLocation[]>([])
  const [showNewLocations, setShowNewLocations] = useState(false)
  const [selectedZip, setSelectedZip] = useState<string | null>(null)
  const [metric, setMetric] = useState<MetricKey>('totalCost')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      fetch('/nyc_zipcodes.geojson').then((r) => r.json() as Promise<FeatureCollection>),
      fetchCsv('/model2_results_final.csv'),
      fetchCsv('/new_facilities_locations.csv'),
    ]).then(([geo, rows, locRows]) => {
      const map: Record<string, Model2Zip> = {}
      const rawMap: Record<string, CsvRow> = {}
      for (const row of rows) {
        const parsed = parseModel2Row(row)
        if (parsed.zipcode) {
          map[parsed.zipcode] = parsed
          rawMap[parsed.zipcode] = row
        }
      }
      const parsedLocs = locRows.map(parseNewFacilityLocation)
      setGeoJson(geo)
      setData(map)
      setRawByZip(rawMap)
      setNewLocations(parsedLocs)
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
    const totalCost = rows.reduce((a, r) => a + (r.totalCost ?? 0), 0)
    const slotsNew = rows.reduce((a, r) => a + (r.slotsFromNew ?? 0), 0)
    const slotsExp = rows.reduce((a, r) => a + (r.slotsFromExpansion ?? 0), 0)
    return { totalCost, slotsNew, slotsExp }
  }, [data])

  const onEachFeature = useCallback(
    (feature: Feature, layer: Layer) => {
      const zip = getZipFromFeature(feature)
      if (!zip || !data) return
      const row = data[zip]
      const raw = rawByZip?.[zip]
      const val = row ? metricValue(row, metric) : undefined
      const color = colorByValue(val, maxMetric)

      const allFieldsHtml = raw
        ? Object.entries(raw)
            .map(([k, v]) => `<div><strong>${k}:</strong> ${v === '' ? 'N/A' : v}</div>`)
            .join('')
        : ''

      const interactive = layer as Layer & {
        setStyle?: (style: PathOptions) => void
        bindTooltip?: (content: string, options?: { sticky?: boolean }) => void
      }
      interactive.setStyle?.({ ...BASE_STYLE, fillColor: color })
      interactive.bindTooltip?.(
        row
          ? `<div style="max-height:260px;overflow:auto;font-size:12px;line-height:1.4"><b>ZIP ${zip}</b><br/>${METRIC_LABELS[metric]}: ${fmt(val)}<br/>Status: ${row.status}<hr style="margin:4px 0"/>${allFieldsHtml}</div>`
          : `<b>ZIP ${zip}</b><br/>No Model2 result row`,
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

  if (loading) return <p style={{ padding: 24 }}>Loading Model2 map...</p>
  if (!geoJson || !data || !rawByZip) return <p style={{ padding: 24 }}>Could not load Model2 data.</p>

  const selected = selectedZip ? data[selectedZip] : undefined
  const selectedRaw = selectedZip ? rawByZip[selectedZip] : undefined
  const selectedZipLocations = selectedZip
    ? newLocations.filter((l) => l.zipcode === selectedZip)
    : []
  const selectedSizeCounts = selectedZipLocations.reduce(
    (acc, l) => {
      const s = (l.size ?? '').toLowerCase()
      if (s === 'small') acc.small += 1
      else if (s === 'medium') acc.medium += 1
      else if (s === 'large') acc.large += 1
      return acc
    },
    { small: 0, medium: 0, large: 0 },
  )

  const locationColor = (size?: string): string => {
    const s = (size ?? '').toLowerCase()
    if (s === 'small') return '#fdae6b'
    if (s === 'medium') return '#9ecae1'
    return '#3182bd'
  }

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
            <input
              type="checkbox"
              checked={showNewLocations}
              onChange={(e) => setShowNewLocations(e.target.checked)}
            />
            {' '}Show new locations by size
          </label>
        </div>
        <MapContainer center={[40.7128, -74.006]} zoom={11} style={{ height: '100%', width: '100%' }}>
          <TileLayer attribution='&copy; <a href="https://openstreetmap.org">OSM</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <GeoJSON key={metric} data={geoJson} onEachFeature={onEachFeature} />
          {showNewLocations &&
            newLocations
              .filter((l) => l.latitude != null && l.longitude != null)
              .map((l, idx) => (
                <CircleMarker
                  key={`${l.zipcode}-${l.locationId ?? idx}-${idx}`}
                  center={[l.latitude as number, l.longitude as number]}
                  radius={2.5}
                  pathOptions={{
                    color: locationColor(l.size),
                    fillColor: locationColor(l.size),
                    fillOpacity: 0.85,
                  }}
                >
                  <Tooltip direction="top">
                    ZIP {l.zipcode} - size: {l.size ?? 'N/A'} - location_id: {l.locationId ?? 'N/A'}
                  </Tooltip>
                </CircleMarker>
              ))}
        </MapContainer>
      </div>

      <aside className="map-info">
        <h3>Model2 - Result map</h3>
        {summary && (
          <div className="legend-box">
            <p className="legend-title">Global summary</p>
            <p>Total cost: ${fmt(summary.totalCost)}</p>
            <p>Slots from new: {fmt(summary.slotsNew)}</p>
            <p>Slots from expansion: {fmt(summary.slotsExp)}</p>
          </div>
        )}

        {selectedZip ? (
          <div className="info-card">
            <p><strong>ZIP:</strong> {selectedZip}</p>
            {selected ? (
              <>
                <p><strong>Status:</strong> {selected.status}</p>
                <hr />
                <p><strong>Total cost:</strong> ${fmt(selected.totalCost)}</p>
                <p><strong>Expansion cost:</strong> ${fmt(selected.expansionCost)}</p>
                <p><strong>Build cost:</strong> ${fmt(selected.buildCost)}</p>
                <p><strong>Slots from expansion:</strong> {fmt(selected.slotsFromExpansion, 1)}</p>
                <p><strong>U5 from expansion:</strong> {fmt(selected.u5FromExpansion, 1)}</p>
                <p><strong>Slots from new:</strong> {fmt(selected.slotsFromNew, 1)}</p>
                <p><strong>U5 from new:</strong> {fmt(selected.u5FromNew, 1)}</p>
                <p><strong>New small / medium / large:</strong> {fmt(selected.newSmall)} / {fmt(selected.newMedium)} / {fmt(selected.newLarge)}</p>
                <p><strong>Total gap:</strong> {fmt(selected.totalGap)}</p>
                <p><strong>U5 gap:</strong> {fmt(selected.u5Gap)}</p>
                <hr />
                <p><strong>New locations in ZIP:</strong> {fmt(selectedZipLocations.length)}</p>
                <p><strong>Size split (S/M/L):</strong> {selectedSizeCounts.small} / {selectedSizeCounts.medium} / {selectedSizeCounts.large}</p>
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
              <p className="hint">No row in `model2_results_final.csv` for this zipcode.</p>
            )}
          </div>
        ) : (
          <p className="hint">Hover/click a zipcode to inspect Model2 outputs.</p>
        )}
      </aside>
    </div>
  )
}

