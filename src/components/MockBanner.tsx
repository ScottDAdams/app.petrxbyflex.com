import { getMockStep } from "../mocks/mockMode"

/**
 * Dev-only banner when mock mode is enabled. Shown at top of main content
 * so screenshots aren't mistaken for real flow.
 */
export function MockBanner() {
  const step = getMockStep()
  if (!step) return null

  const label = step.charAt(0).toUpperCase() + step.slice(1)
  return (
    <div className="mock-banner" role="status" aria-live="polite">
      MOCK MODE: {label}
    </div>
  )
}
