import { useLocation } from "react-router-dom"
import { SessionProvider } from "./SessionContext"

/**
 * Provides session when URL is /start?session_id=...
 * Otherwise children render without session (idle).
 */
export function SessionProviderFromUrl({
  children,
}: {
  children: React.ReactNode
}) {
  const { pathname, search } = useLocation()
  const sessionId =
    pathname === "/start" || pathname === "/start/"
      ? new URLSearchParams(search).get("session_id")?.trim() ?? null
      : null

  return <SessionProvider sessionId={sessionId}>{children}</SessionProvider>
}
