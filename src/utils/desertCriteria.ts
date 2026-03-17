import type { ZipCodeStats } from './zipData'

export interface DesertStatus {
  isHighDemand: boolean
  isDesert: boolean
  isDesert0to5: boolean
  slotsPerChild0to12?: number
  slotsPerChild0to5?: number
}

/**
 * High-demand: employment rate >= 60% OR average income <= $60,000.
 * Desert (high-demand): slots <= 0.5 * children 0–12.
 * Desert (normal):      slots <= (1/3) * children 0–12.
 * Desert 0–5:           slots_0to5 < (2/3) * children 0–5.
 */
export function classifyZipcode(stats: ZipCodeStats): DesertStatus {
  const empRate = stats.employmentRate ?? 0
  const income = stats.avgIncome ?? Infinity

  const isHighDemand = empRate >= 0.6 || income <= 60000

  const children0to12 = stats.totalChildren0to12 ?? 0
  const children0to5 = stats.children0to5 ?? 0
  const slots = stats.existingSlotsTotal ?? 0
  const slots0to5 = stats.existingSlots0to5 ?? 0

  let isDesert = false
  if (children0to12 > 0) {
    const threshold = isHighDemand ? 0.5 : 1 / 3
    isDesert = slots <= threshold * children0to12
  }

  const isDesert0to5 = children0to5 > 0 ? slots0to5 < (2 / 3) * children0to5 : false

  const slotsPerChild0to12 = children0to12 > 0 ? slots / children0to12 : undefined
  const slotsPerChild0to5 = children0to5 > 0 ? slots0to5 / children0to5 : undefined

  return { isHighDemand, isDesert, isDesert0to5, slotsPerChild0to12, slotsPerChild0to5 }
}
