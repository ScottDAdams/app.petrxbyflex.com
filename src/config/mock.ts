import { getMockStep } from "../mocks/mockMode"

/**
 * Single source of truth for mock mode. Enabled when ?mock= is in URL or
 * localStorage PETRX_MOCK_FLOW === "1", AND when in dev mode or VITE_ENABLE_MOCKS=true.
 * Use this instead of scattering getMockStep() !== null checks.
 */
export function isMockMode(): boolean {
  const enableMocks = import.meta.env.DEV || import.meta.env.VITE_ENABLE_MOCKS === "true"
  if (!enableMocks) return false
  return getMockStep() !== null
}
