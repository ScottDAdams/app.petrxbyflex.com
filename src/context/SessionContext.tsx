/**
 * Session context: holds backend session for the card + quote flow.
 *
 * FRAMER SEAM: Session is loaded only when user lands on /start?session_id=...
 * (redirect from Framer). Backend is the source of truth; no Framer runtime here.
 * When mock mode is enabled (?mock=... or PETRX_MOCK_FLOW), session comes from mocks only.
 */
import React, { createContext, useContext, useCallback, useState } from "react"
import type { MockStep } from "../mocks/sessions"
import { mockSessions } from "../mocks/sessions"
import { fetchSession, SessionData } from "../api/session"

type SessionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; session: SessionData }
  | { status: "error"; message: string }

type SessionContextValue = {
  state: SessionState
  refetch: () => Promise<void>
  setSession: (session: SessionData | null) => void
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({
  sessionId,
  mockStep,
  children,
}: {
  sessionId: string | null
  mockStep: MockStep | null
  children: React.ReactNode
}) {
  const [state, setState] = useState<SessionState>(
    sessionId || mockStep ? { status: "loading" } : { status: "idle" }
  )

  const load = useCallback(async () => {
    if (mockStep) {
      setState({ status: "ready", session: mockSessions[mockStep] })
      return
    }
    if (!sessionId) {
      setState({ status: "idle" })
      return
    }
    setState({ status: "loading" })
    try {
      const session = await fetchSession(sessionId)
      setState({ status: "ready", session })
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid session"
      setState({ status: "error", message })
    }
  }, [sessionId, mockStep])

  React.useEffect(() => {
    load()
  }, [load])

  const setSession = useCallback((session: SessionData | null) => {
    if (session) setState({ status: "ready", session })
    else setState({ status: "idle" })
  }, [])

  const value: SessionContextValue = {
    state,
    refetch: load,
    setSession,
  }

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  )
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext)
  if (!ctx) throw new Error("useSession must be used within SessionProvider")
  return ctx
}

export function useSessionOptional(): SessionContextValue | null {
  return useContext(SessionContext)
}
