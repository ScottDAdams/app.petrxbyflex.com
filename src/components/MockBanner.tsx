import { useSearchParams } from "react-router-dom"
import { isMockMode } from "../config/mock"
import { getMockStep } from "../mocks/mockMode"
import type { MockStep } from "../mocks/sessions"

const MOCK_STEPS: MockStep[] = ["quote", "details", "payment", "confirm"]

/**
 * Dev-only banner when mock mode is enabled. Banner + tiny step switcher
 * so it doesn't compete with the real stepper.
 */
export function MockBanner() {
  if (!isMockMode()) return null
  const [searchParams, setSearchParams] = useSearchParams()
  const step = getMockStep()
  if (!step) return null

  const label = step.charAt(0).toUpperCase() + step.slice(1)

  const setMock = (s: MockStep) => {
    const next = new URLSearchParams(searchParams)
    next.set("mock", s)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="mock-banner" role="status" aria-live="polite">
      <span className="mock-banner__label">MOCK MODE: {label}</span>
      <div className="mock-banner__switcher">
        <span className="mock-banner__switcher-label">Switch step:</span>
        {MOCK_STEPS.map((s) => (
          <span key={s}>
            <button
              type="button"
              className="mock-banner__link"
              aria-current={step === s ? "step" : undefined}
              onClick={() => setMock(s)}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
            {s !== MOCK_STEPS[MOCK_STEPS.length - 1] && " | "}
          </span>
        ))}
      </div>
    </div>
  )
}
