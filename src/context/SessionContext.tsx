import React, { createContext, useContext, useCallback, useState } from "react"
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
  children,
}: {
  sessionId: string | null
  children: React.ReactNode
}) {
  const [state, setState] = useState<SessionState>(
    sessionId ? { status: "loading" } : { status: "idle" }
  )

  const load = useCallback(async () => {
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
  }, [sessionId])

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
