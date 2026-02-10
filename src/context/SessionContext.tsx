/**
 * Session context: holds backend session for the card + quote flow.
 *
 * FRAMER SEAM: Session is loaded only when user lands on /start?session_id=...
 * (redirect from Framer). Backend is the source of truth; no Framer runtime here.
 * When mock mode is enabled (?mock=... or PETRX_MOCK_FLOW), session comes from mocks only.
 */
import React, { createContext, useContext, useCallback, useRef, useState } from "react"
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
  /** Refetch session from API; returns the fetched session on success (so callers can merge fields). */
  refetch: () => Promise<SessionData | null>
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
  const stateRef = useRef(state)
  stateRef.current = state

  const load = useCallback(async (): Promise<SessionData | null> => {
    if (mockStep) {
      setState({ status: "ready", session: mockSessions[mockStep] })
      return null
    }
    if (!sessionId) {
      setState({ status: "idle" })
      return null
    }
    setState({ status: "loading" })
    try {
      const session = await fetchSession(sessionId)
      setState({ status: "ready", session })
      return session
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid session"
      setState({ status: "error", message })
      return null
    }
  }, [sessionId, mockStep])

  /** Refetch from API. If we already have a session (ready), do not set loading — refresh in background to avoid unmounting the flow. */
  const refetch = useCallback(async (): Promise<SessionData | null> => {
    if (mockStep) {
      setState({ status: "ready", session: mockSessions[mockStep] })
      return null
    }
    if (!sessionId) {
      setState({ status: "idle" })
      return null
    }
    const isBackground = stateRef.current.status === "ready"
    if (!isBackground) setState({ status: "loading" })
    try {
      const session = await fetchSession(sessionId)
      setState({ status: "ready", session })
      return session
    } catch (e) {
      const message = e instanceof Error ? e.message : "Invalid session"
      setState({ status: "error", message })
      return null
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
    refetch,
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
