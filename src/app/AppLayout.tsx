import { Outlet } from "react-router-dom"
import { useSessionOptional } from "../context/SessionContext"
import { AppHeader } from "../components/AppHeader"

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
        <Outlet />
      </main>
    </div>
  )
}
