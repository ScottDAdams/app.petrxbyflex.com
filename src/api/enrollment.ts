import { API_BASE } from "./index"

export type EnrollStatusResponse =
  | {
      outcome: "success"
      registrationRedirectUrl: string
      enrollmentStatus?: string
    }
  | {
      outcome: "pending_confirmation"
      enrollmentStatus?: string
      reconciliation?: {
        hasOneincAccountId?: boolean
        hasPaymentToken?: boolean
        hasTransactionId?: boolean
        hasLeadId?: boolean
        retrieveQuoteUrl?: string | null
        likelyEnrolledHint?: boolean
      }
    }
  | {
      outcome: "unknown"
      message?: string
    }

export async function fetchEnrollStatus(sessionId: string): Promise<EnrollStatusResponse> {
  const r = await fetch(
    `${API_BASE}/api/enrollment/enroll-status?session_id=${encodeURIComponent(sessionId)}`
  )
  if (r.status === 404) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || "Session not found")
  }
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error((err as { message?: string }).message || `enroll-status failed: ${r.status}`)
  }
  return r.json() as Promise<EnrollStatusResponse>
}
