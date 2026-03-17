export type CsvRow = Record<string, string>

export function normalizeZip(zip: string | number | undefined): string {
  if (zip == null) return ''
  const cleaned = String(zip).replace(/["']/g, '').trim()
  if (!cleaned) return ''
  return cleaned.padStart(5, '0')
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

export function parseCsv(text: string): CsvRow[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0) return []
  const header = parseCsvLine(lines[0])
  const rows: CsvRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i])
    const row: CsvRow = {}
    for (let c = 0; c < header.length; c++) {
      row[header[c]] = values[c] ?? ''
    }
    rows.push(row)
  }
  return rows
}

export async function fetchCsv(path: string): Promise<CsvRow[]> {
  const resp = await fetch(path)
  const text = await resp.text()
  return parseCsv(text)
}

export function num(row: CsvRow, key: string): number | undefined {
  const v = Number(row[key])
  return Number.isFinite(v) ? v : undefined
}

export function bool(row: CsvRow, key: string): boolean {
  return String(row[key]).toLowerCase() === 'true'
}
