/**
 * Layout with conditional header driven by session.funnel_type + current_step.
 *
 * FRAMER SEAM: This app is entered only via /start?session_id=... from Framer.
 * When mock mode is enabled, session comes from mocks; banner is shown.
 */
import { Outlet } from "react-router-dom"
import { useSessionOptional } from "../context/SessionContext"
import { useLeadLoading } from "../context/LeadLoadingContext"
import { AppHeader } from "../components/AppHeader"
import { MockBanner } from "../components/MockBanner"
import { FancyLoadingOverlay } from "../components/insurance/FancyLoadingOverlay"

export function AppLayout() {
  const sessionContext = useSessionOptional()
  const { leadLoading } = useLeadLoading()

  const isQuoteSteps = (): boolean => {
    if (!sessionContext || sessionContext.state.status !== "ready") return true
    const { session } = sessionContext.state
    const step = (session.current_step ?? "").toLowerCase()
    const funnel = (session.funnel_type ?? "").toLowerCase()
    if (funnel === "card_only" || funnel === "card_only_flow") return true
    // Hide Med Lookup during quote flow steps
    if (step === "quote" || step === "details" || step === "payment" || step === "confirm" || step === "plan_select") return true
    return false
  }

  const showFullHeader =
    sessionContext?.state.status === "ready" && !isQuoteSteps()

  const ownerFirstName =
    sessionContext?.state.status === "ready"
      ? (sessionContext.state as { session: { owner?: { first_name?: string } } }).session?.owner?.first_name
      : undefined

  return (
    <div className="app-layout">
      <AppHeader fullNav={showFullHeader} />
      <main className="app-main">
        <div id="petrx-container" className="petrx-container" style={{ position: "relative" }}>
          {leadLoading && (
            <FancyLoadingOverlay visible={leadLoading} ownerFirstName={ownerFirstName} />
          )}
          <MockBanner />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
