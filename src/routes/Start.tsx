/**
 * Entry route for the card + insurance quote flow.
 *
 * FRAMER SEAM: This app is entered ONLY via redirect from Framer with a session_id.
 * When mock mode is enabled (?mock=... or PETRX_MOCK_FLOW), session_id is optional.
 */
import { useSearchParams } from "react-router-dom"
import { getMockStep } from "../mocks/mockMode"
import type { MockStep } from "../mocks/sessions"
import { useSession } from "../context/SessionContext"
import { CardAndQuoteFlow } from "../components/CardAndQuoteFlow"

const MOCK_STEPS: MockStep[] = ["quote", "details", "payment", "confirm"]

function MockSwitcher() {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = searchParams.get("mock") ?? "quote"

  const setMock = (step: MockStep) => {
    const next = new URLSearchParams(searchParams)
    next.set("mock", step)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="mock-switcher" role="tablist" aria-label="Mock step">
      {MOCK_STEPS.map((step) => (
        <button
          key={step}
          type="button"
          role="tab"
          aria-selected={current === step}
          className={`mock-switcher__btn ${current === step ? "mock-switcher__btn--active" : ""}`}
          onClick={() => setMock(step)}
        >
          {step.charAt(0).toUpperCase() + step.slice(1)}
        </button>
      ))}
    </div>
  )
}

function StartContent() {
  const { state } = useSession()
  const mockStep = getMockStep()

  if (state.status === "loading") {
    return (
      <div className="start-message">
        <p>Loading session...</p>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="start-message start-error">
        <p>{state.message}</p>
        <p>Please try again or return to the previous page.</p>
      </div>
    )
  }

  if (state.status === "ready") {
    return (
      <>
        {mockStep && <MockSwitcher />}
        <CardAndQuoteFlow />
      </>
    )
  }

  return null
}

export function Start() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get("session_id")?.trim()
  const mockStep = getMockStep()

  if (!sessionId && !mockStep) {
    return (
      <div className="start-message start-error">
        <p>Missing session. A valid session_id is required.</p>
      </div>
    )
  }

  return <StartContent />
}
