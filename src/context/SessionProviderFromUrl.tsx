import { useLocation } from "react-router-dom"
import { getMockStep } from "../mocks/mockMode"
import { SessionProvider } from "./SessionContext"
import { LeadLoadingProvider } from "./LeadLoadingContext"

/**
 * Provides session when URL is /start?session_id=... or when mock mode is enabled (?mock=... or PETRX_MOCK_FLOW).
 * Otherwise children render without session (idle).
 */
export function SessionProviderFromUrl({
  children,
}: {
  children: React.ReactNode
}) {
  const { pathname, search } = useLocation()
  const isStart = pathname === "/start" || pathname === "/start/"
  const sessionId = isStart
    ? new URLSearchParams(search).get("session_id")?.trim() ?? null
    : null
  const mockStep = isStart ? getMockStep() : null

  return (
    <SessionProvider sessionId={sessionId} mockStep={mockStep}>
      <LeadLoadingProvider>
        {children}
      </LeadLoadingProvider>
    </SessionProvider>
  )
}
