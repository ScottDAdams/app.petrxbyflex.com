import { API_BASE } from "./index"

export type SessionData = {
  session_id: string
  card_image_url?: string
  wallet_url?: string
  insurance_products?: unknown[]
  current_step?: string
  funnel_type?: string
  [key: string]: unknown
}

export async function fetchSession(sessionId: string): Promise<SessionData> {
  const url = `${API_BASE}/enroll/session?session_id=${encodeURIComponent(sessionId)}`
  const res = await fetch(url)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Session fetch failed: ${res.status}`)
  }
  const data = await res.json()
  return { ...data, session_id: data.session_id ?? sessionId }
}

/**
 * Update session step on the backend. UI should refetch session after.
 */
export async function updateSessionStep(
  sessionId: string,
  stepId: string,
  payload?: Record<string, unknown>
): Promise<SessionData> {
  const url = `${API_BASE}/enroll/session`
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      current_step: stepId,
      ...payload,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Session update failed: ${res.status}`)
  }
  const data = await res.json()
  return { ...data, session_id: data.session_id ?? sessionId }
}
