import type { MockStep } from "./sessions"

const ALLOWED_STEPS: MockStep[] = ["quote", "details", "payment", "confirm"]

export type MockModeResult = { enabled: boolean; step: MockStep | null }

/**
 * Parse mock step from URL query (?mock=quote|details|payment|confirm).
 * Returns the step only if it's one of the allowed values.
 */
export function getMockStepFromUrl(): MockStep | null {
  const params = new URLSearchParams(window.location.search)
  const v = params.get("mock")?.toLowerCase().trim()
  if (!v) return null
  return ALLOWED_STEPS.includes(v as MockStep) ? (v as MockStep) : null
}

/**
 * Get active mock step: from URL first, then localStorage PETRX_MOCK_FLOW for default "quote".
 */
export function getMockStep(): MockStep | null {
  const fromUrl = getMockStepFromUrl()
  if (fromUrl) return fromUrl
  if (typeof localStorage !== "undefined" && localStorage.getItem("PETRX_MOCK_FLOW") === "1") {
    return "quote"
  }
  return null
}

/**
 * Whether mock mode is enabled (URL or localStorage).
 */
export function isMockModeEnabled(): boolean {
  return getMockStep() !== null
}
