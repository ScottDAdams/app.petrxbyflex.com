import type { EnrollmentEventMetadata } from "../api/analytics"

export type BreedInsightsMetadata = EnrollmentEventMetadata & {
  breed_type_id?: number | null
  speciesType?: string
}

/** Placeholder breed insights when no API is wired. Replace with real fetch when backend is ready. */
const MOCK_ABOUT_BULLETS = [
  "Breeds in this group are often known for their friendly and adaptable nature, forming strong bonds with their families.",
  "They typically benefit from regular mental and physical stimulation to stay happy and healthy.",
]
const MOCK_CONSIDERATION_BULLETS = [
  "Some breeds may be prone to orthopedic issues due to activity level; regular check-ups can help.",
  "Dental health can be a concern, so regular dental care may be beneficial.",
]

export function useBreedInsights(
  speciesType: string,
  _breedTypeId?: number | null,
  _analyticsMetadata?: BreedInsightsMetadata
): {
  aboutBullets: string[]
  considerationBullets: string[]
  isLoading: boolean
  hasContent: boolean
} {
  const hasSpecies = typeof speciesType === "string" && speciesType.trim().length > 0
  return {
    aboutBullets: hasSpecies ? MOCK_ABOUT_BULLETS : [],
    considerationBullets: hasSpecies ? MOCK_CONSIDERATION_BULLETS : [],
    isLoading: false,
    hasContent: hasSpecies,
  }
}
