export interface ZipDemandInput {
  zipcode: string
  children0to5: number
  children0to12: number
  employmentRate: number
  avgIncome: number
  existingSlots0to5: number
  existingSlotsTotal: number
}

export interface NewFacilityOption {
  label: 'small' | 'medium' | 'large'
  totalSlots: number
  slots0to5: number
  fixedCost: number
}

export interface ExpansionDecision {
  facilityId: string
  zipcode: string
  currentSlots: number
  addedSlots: number
  addedSlots0to5: number
  expansionCost: number
}

export interface ModelRunSummary {
  objectiveValue: number
  totalNewFacilities: number
  totalExpandedFacilities: number
  desertsEliminated: number
}

export const FACILITY_OPTIONS: NewFacilityOption[] = [
  { label: 'small', totalSlots: 100, slots0to5: 50, fixedCost: 65000 },
  { label: 'medium', totalSlots: 200, slots0to5: 100, fixedCost: 95000 },
  { label: 'large', totalSlots: 400, slots0to5: 200, fixedCost: 115000 },
]
