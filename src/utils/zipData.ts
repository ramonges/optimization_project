export interface ZipCodeStats {
  zipcode: string
  avgIncome?: number
  employmentRate?: number
  totalPopulation?: number
  children0to5?: number
  children6to12?: number
  totalChildren0to12?: number
  existingSlotsTotal?: number
  existingSlots0to5?: number
  facilityCount?: number
  potentialLocationCount?: number
}

function parseCsv(text: string): string[][] {
  const lines = text.trim().split(/\r?\n/)
  return lines.map(parseCsvLine)
}

function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (ch === ',' && !inQuotes) {
      out.push(current.trim())
      current = ''
      continue
    }

    current += ch
  }

  out.push(current.trim())
  return out
}

function normalizeZip(zip: string): string {
  const cleaned = zip.replace(/["']/g, '').trim()
  if (!cleaned) return ''
  return cleaned.padStart(5, '0')
}

export async function loadZipData(): Promise<Record<string, ZipCodeStats>> {
  const [incomeResp, employmentResp, populationResp, childCareResp, locationsResp] =
    await Promise.all([
      fetch('/avg_individual_income_nyc.csv'),
      fetch('/employment_rate_nyc.csv'),
      fetch('/population_nyc.csv'),
      fetch('/child_care_regulated_nyc.csv'),
      fetch('/potential_locations_nyc.csv'),
    ])

  const [incomeText, employmentText, populationText, childCareText, locationsText] =
    await Promise.all([
      incomeResp.text(),
      employmentResp.text(),
      populationResp.text(),
      childCareResp.text(),
      locationsResp.text(),
    ])

  const byZip = new Map<string, ZipCodeStats>()

  function getOrCreate(zip: string): ZipCodeStats {
    let s = byZip.get(zip)
    if (!s) {
      s = { zipcode: zip }
      byZip.set(zip, s)
    }
    return s
  }

  // --- Average income ---
  const incomeRows = parseCsv(incomeText)
  for (let i = 1; i < incomeRows.length; i++) {
    const row = incomeRows[i]
    const zip = normalizeZip(row[1])
    if (!zip) continue
    const val = Number(row[2])
    if (Number.isFinite(val)) getOrCreate(zip).avgIncome = val
  }

  // --- Employment rate ---
  const empRows = parseCsv(employmentText)
  for (let i = 1; i < empRows.length; i++) {
    const row = empRows[i]
    const zip = normalizeZip(row[1])
    if (!zip) continue
    const val = Number(row[2])
    if (Number.isFinite(val)) getOrCreate(zip).employmentRate = val
  }

  // --- Population (columns: ,zipcode,Total,-5,6-12,...) ---
  const popRows = parseCsv(populationText)
  const popHeader = popRows[0]
  const popTotalIdx = popHeader.indexOf('Total')
  const pop0to5Idx = popHeader.indexOf('-5')
  const pop6to12Idx = popHeader.indexOf('6-12')
  for (let i = 1; i < popRows.length; i++) {
    const row = popRows[i]
    const zip = normalizeZip(row[1])
    if (!zip) continue
    const s = getOrCreate(zip)
    const total = Number(row[popTotalIdx])
    const c05 = Number(row[pop0to5Idx])
    const c612 = Number(row[pop6to12Idx])
    if (Number.isFinite(total)) s.totalPopulation = total
    if (Number.isFinite(c05)) s.children0to5 = c05
    if (Number.isFinite(c612)) s.children6to12 = c612
    if (Number.isFinite(c05) && Number.isFinite(c612))
      s.totalChildren0to12 = c05 + c612
  }

  // --- Child care facilities (aggregate per zipcode) ---
  const ccRows = parseCsv(childCareText)
  const ccHeader = ccRows[0]
  const ccZipIdx = ccHeader.indexOf('zipcode')
  const ccTotalCapIdx = ccHeader.indexOf('total_capacity')
  const ccInfantIdx = ccHeader.indexOf('infant_capacity')
  const ccToddlerIdx = ccHeader.indexOf('toddler_capacity')
  const ccPreschoolIdx = ccHeader.indexOf('preschool_capacity')

  const ccAgg = new Map<string, { total: number; under5: number; count: number }>()
  for (let i = 1; i < ccRows.length; i++) {
    const row = ccRows[i]
    const zip = normalizeZip(row[ccZipIdx])
    if (!zip) continue
    const totalCap = Number(row[ccTotalCapIdx]) || 0
    const infant = Number(row[ccInfantIdx]) || 0
    const toddler = Number(row[ccToddlerIdx]) || 0
    const preschool = Number(row[ccPreschoolIdx]) || 0
    const prev = ccAgg.get(zip) ?? { total: 0, under5: 0, count: 0 }
    prev.total += totalCap
    prev.under5 += infant + toddler + preschool
    prev.count += 1
    ccAgg.set(zip, prev)
  }
  for (const [zip, agg] of ccAgg) {
    const s = getOrCreate(zip)
    s.existingSlotsTotal = agg.total
    s.existingSlots0to5 = agg.under5
    s.facilityCount = agg.count
  }

  // --- Potential locations (count per zipcode) ---
  const locRows = parseCsv(locationsText)
  const locAgg = new Map<string, number>()
  for (let i = 1; i < locRows.length; i++) {
    const row = locRows[i]
    const zip = normalizeZip(row[1])
    if (!zip) continue
    locAgg.set(zip, (locAgg.get(zip) ?? 0) + 1)
  }
  for (const [zip, count] of locAgg) {
    getOrCreate(zip).potentialLocationCount = count
  }

  const result: Record<string, ZipCodeStats> = {}
  for (const [zip, value] of byZip) {
    result[zip] = value
  }
  return result
}
