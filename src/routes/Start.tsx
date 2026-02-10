/**
 * Entry route for the card + insurance quote flow.
 *
 * FRAMER SEAM: This app is entered ONLY via redirect from Framer with a session_id.
 * When mock mode is enabled (?mock=... or PETRX_MOCK_FLOW), session_id is optional.
 * Mock banner + switcher live in AppLayout (MockBanner); only the real stepper shows here.
 */
import { useSearchParams } from "react-router-dom"
import { getMockStep } from "../mocks/mockMode"
import { useSession } from "../context/SessionContext"
import { CardAndQuoteFlow } from "../components/CardAndQuoteFlow"

function StartContent() {
  const { state } = useSession()

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
    return <CardAndQuoteFlow />
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
