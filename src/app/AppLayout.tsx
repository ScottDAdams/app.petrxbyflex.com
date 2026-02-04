/**
 * Layout with conditional header driven by session.funnel_type + current_step.
 *
 * FRAMER SEAM: This app is entered only via /start?session_id=... from Framer.
 * When mock mode is enabled, session comes from mocks; banner is shown.
 */
import { Outlet } from "react-router-dom"
import { useSessionOptional } from "../context/SessionContext"
import { AppHeader } from "../components/AppHeader"
import { MockBanner } from "../components/MockBanner"

export function AppLayout() {
  const sessionContext = useSessionOptional()

  const isQuoteSteps = (): boolean => {
    if (!sessionContext || sessionContext.state.status !== "ready") return true
    const { session } = sessionContext.state
    const step = (session.current_step ?? "").toLowerCase()
    const funnel = (session.funnel_type ?? "").toLowerCase()
    if (funnel === "card_only" || funnel === "card_only_flow") return true
    if (step === "quote" || step === "details" || step === "plan_select") return true
    return false
  }

  const showFullHeader =
    sessionContext?.state.status === "ready" && !isQuoteSteps()

  return (
    <div className="app-layout">
      <AppHeader fullNav={showFullHeader} />
      <main className="app-main">
        <div className="petrx-container">
          <MockBanner />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
