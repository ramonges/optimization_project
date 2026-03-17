import { readFileSync, writeFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

type ZipKey = string

interface ZipCodeStats {
  zipcode: string
  avgIncome?: number
  totalChildren?: number
  children0to5?: number
  employmentRate?: number
  existingSlotsTotal?: number
  existingSlots0to5?: number
  potentialLocations: Array<{
    id: string
    lat: number
    lon: number
  }>
}

function parseCsv(path: string): string[][] {
  const raw = readFileSync(path, 'utf8')
  const lines = raw.trim().split(/\r?\n/)
  return lines.map((line) => {
    // very simple CSV split; datasets here do not contain commas inside quotes
    return line.split(',').map((v) => v.trim())
  })
}

function normalizeZip(zip: string): ZipKey {
  const cleaned = zip.replace(/["']/g, '').trim()
  if (!cleaned) return ''
  return cleaned.padStart(5, '0')
}

function loadIncome(csvDir: string, stats: Map<ZipKey, ZipCodeStats>) {
  const rows = parseCsv(resolve(csvDir, 'avg_individual_income_nyc.csv'))
  const [, ...data] = rows
  for (const row of data) {
    const [, zipcode, avgIncomeStr] = row
    const zip = normalizeZip(zipcode)
    if (!zip) continue
    const avgIncome = Number(avgIncomeStr)
    const existing = stats.get(zip) ?? { zipcode: zip, potentialLocations: [] }
    existing.avgIncome = Number.isFinite(avgIncome) ? avgIncome : undefined
    stats.set(zip, existing)
  }
}

function loadPopulation(csvDir: string, stats: Map<ZipKey, ZipCodeStats>) {
  const rows = parseCsv(resolve(csvDir, 'population_nyc.csv'))
  const [header, ...data] = rows
  const zipcodeIdx = header.indexOf('zipcode')
  const totalIdx = header.indexOf('Total')
  const zeroToFiveIdx = header.indexOf('-5')

  for (const row of data) {
    const zip = normalizeZip(row[zipcodeIdx])
    if (!zip) continue
    const total = Number(row[totalIdx] ?? '')
    const zeroToFive = Number(row[zeroToFiveIdx] ?? '')
    const existing = stats.get(zip) ?? { zipcode: zip, potentialLocations: [] }
    existing.totalChildren = Number.isFinite(total) ? total : existing.totalChildren
    existing.children0to5 = Number.isFinite(zeroToFive)
      ? zeroToFive
      : existing.children0to5
    stats.set(zip, existing)
  }
}

function loadEmployment(csvDir: string, stats: Map<ZipKey, ZipCodeStats>) {
  const rows = parseCsv(resolve(csvDir, 'employment_rate_nyc.csv'))
  const [header, ...data] = rows
  const zipcodeIdx = header.indexOf('zipcode')
  const rateIdx = header.findIndex((h) => /employment/i.test(h))

  for (const row of data) {
    const zip = normalizeZip(row[zipcodeIdx])
    if (!zip) continue
    const rate = Number(row[rateIdx] ?? '')
    const existing = stats.get(zip) ?? { zipcode: zip, potentialLocations: [] }
    existing.employmentRate = Number.isFinite(rate) ? rate : existing.employmentRate
    stats.set(zip, existing)
  }
}

function loadChildCare(csvDir: string, stats: Map<ZipKey, ZipCodeStats>) {
  const rows = parseCsv(resolve(csvDir, 'child_care_regulated_nyc.csv'))
  const [header, ...data] = rows
  const zipcodeIdx = header.indexOf('zip_code')
  const totalSlotsIdx = header.findIndex((h) => /total_slots/i.test(h))
  const zeroToFiveIdx = header.findIndex((h) => /0_5|0-5/i.test(h))

  const agg = new Map<ZipKey, { total: number; zeroToFive: number }>()

  for (const row of data) {
    const zip = normalizeZip(row[zipcodeIdx])
    if (!zip) continue
    const total = Number(row[totalSlotsIdx] ?? '') || 0
    const zeroToFive = zeroToFiveIdx >= 0 ? Number(row[zeroToFiveIdx] ?? '') || 0 : 0
    const prev = agg.get(zip) ?? { total: 0, zeroToFive: 0 }
    prev.total += total
    prev.zeroToFive += zeroToFive
    agg.set(zip, prev)
  }

  for (const [zip, { total, zeroToFive }] of agg) {
    const existing = stats.get(zip) ?? { zipcode: zip, potentialLocations: [] }
    existing.existingSlotsTotal = total
    existing.existingSlots0to5 = zeroToFive
    stats.set(zip, existing)
  }
}

function loadPotentialLocations(csvDir: string, stats: Map<ZipKey, ZipCodeStats>) {
  const rows = parseCsv(resolve(csvDir, 'potential_locations_nyc.csv'))
  const [header, ...data] = rows
  const zipcodeIdx = header.indexOf('zipcode')
  const idIdx = header.findIndex((h) => /id/i.test(h))
  const latIdx = header.findIndex((h) => /lat/i.test(h))
  const lonIdx = header.findIndex((h) => /lon|lng|long/i.test(h))

  for (const row of data) {
    const zip = normalizeZip(row[zipcodeIdx])
    if (!zip) continue
    const id = row[idIdx] ?? ''
    const lat = Number(row[latIdx] ?? '')
    const lon = Number(row[lonIdx] ?? '')
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const existing = stats.get(zip) ?? { zipcode: zip, potentialLocations: [] }
    existing.potentialLocations = [
      ...(existing.potentialLocations ?? []),
      { id, lat, lon },
    ]
    stats.set(zip, existing)
  }
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url))
  const projectRoot = resolve(here, '..', '..')
  const csvDir = projectRoot
  const outPath = resolve(here, '..', 'public', 'zip_data_nyc.json')

  const stats = new Map<ZipKey, ZipCodeStats>()

  loadIncome(csvDir, stats)
  loadPopulation(csvDir, stats)
  loadEmployment(csvDir, stats)
  loadChildCare(csvDir, stats)
  loadPotentialLocations(csvDir, stats)

  const result: Record<ZipKey, ZipCodeStats> = {}
  for (const [zip, value] of stats) {
    result[zip] = {
      zipcode: value.zipcode,
      avgIncome: value.avgIncome,
      totalChildren: value.totalChildren,
      children0to5: value.children0to5,
      employmentRate: value.employmentRate,
      existingSlotsTotal: value.existingSlotsTotal,
      existingSlots0to5: value.existingSlots0to5,
      potentialLocations: value.potentialLocations ?? [],
    }
  }

  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8')
  console.log(`Wrote merged zipcode data to ${outPath}`)
}

main()

