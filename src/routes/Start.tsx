import { useSearchParams } from "react-router-dom"
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

  if (!sessionId) {
    return (
      <div className="start-message start-error">
        <p>Missing session. A valid session_id is required.</p>
      </div>
    )
  }

  return <StartContent />
}
