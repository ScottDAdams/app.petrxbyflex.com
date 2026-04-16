import { API_BASE } from "./index"

export type PersistOneIncCompletionInput = {
  session_id: string
  paymentToken: string
  transactionId: string
  paymentMethod?: string
  status?: string
  raw?: Record<string, unknown>
}

/**
 * JSON body returned by POST /api/oneinc/complete on success.
 * Preserve this object in full for HP Enroll: paymentDetails.fullPaymentResponse must be
 * JSON.stringify(this entire response), not a reduced portalOne fragment (see EnrollmentAdapter).
 */
export type OneIncCompleteApiResponse = {
  success?: boolean
  session_id?: string
  payment?: Record<string, unknown>
  portal_one_inspection?: Record<string, unknown>
  error?: string
}

export type PersistOneIncCompletionResponse = OneIncCompleteApiResponse & Record<string, unknown>

/**
 * Persist OneInc modal success server-side (POST /api/oneinc/complete).
 * Call immediately after OneInc reports success so reload keeps payment context.
 * Returns the full successful response body — keep it for enroll (fullPaymentResponse).
 */
export async function persistOneIncCompletion(
  input: PersistOneIncCompletionInput
): Promise<PersistOneIncCompletionResponse> {
  const res = await fetch(`${API_BASE}/api/oneinc/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: input.session_id,
      paymentToken: input.paymentToken,
      transactionId: input.transactionId,
      paymentMethod: input.paymentMethod,
      status: input.status,
      raw: input.raw,
    }),
  })
  let data: PersistOneIncCompletionResponse = {}
  try {
    data = (await res.json()) as PersistOneIncCompletionResponse
  } catch {
    data = { error: `Invalid JSON (${res.status})` }
  }
  if (!res.ok) {
    return {
      ...data,
      error: data.error || (typeof data === "object" && data && "message" in data
        ? String((data as { message?: string }).message)
        : `HTTP ${res.status}`),
    }
  }
  return data
}
