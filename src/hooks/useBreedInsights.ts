import type { EnrollmentEventMetadata } from "../api/analytics"

export type BreedInsightsMetadata = EnrollmentEventMetadata & {
  breed_type_id?: number | null
  speciesType?: string
}

export function useBreedInsights(
  _speciesType: string,
  _breedTypeId?: number | null,
  _analyticsMetadata?: BreedInsightsMetadata
): {
  aboutBullets: string[]
  considerationBullets: string[]
  isLoading: boolean
  hasContent: boolean
} {
  return {
    aboutBullets: [],
    considerationBullets: [],
    isLoading: false,
    hasContent: false,
  }
}
