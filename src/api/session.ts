import { API_BASE } from "./index"

/** Pet shape returned by GET/PATCH /enroll/session (from pet_prescription_signups). */
export type SessionPet = {
  name?: string | null
  type?: "dog" | "cat" | string | null
  sex?: string | null
  breed_id?: number | null
  breed_label?: string | null
  birth_month?: number | null
  birth_year?: number | null
  zip_code?: string | null
}

/** Owner shape returned by GET/PATCH /enroll/session. */
export type SessionOwner = {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  phone?: string | null
  mailing_street?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
}

/** Plan selection persisted on Continue from quote step. */
export type SessionPlan = {
  plan_id?: string | null
  reimbursement?: string | null
  deductible?: string | null
  is_high_deductible?: boolean | null
}

/**
 * Frontend contract: backend must return these field names (or map in normalizeSession).
 * Expected: funnel_type, current_step, card_image_url, wallet_url, insurance_products, pet, owner,
 * lead_id, quote_detail_id (from GET after PATCH persists them).
 */
export type SessionData = {
  session_id: string
  card_image_url?: string
  wallet_url?: string
  wallet_pass_url?: string
  qr_code_url?: string
  qr_code_url_android?: string
  insurance_products?: unknown[]
  current_step?: string
  funnel_type?: string
  lead_id?: string | null
  quote_detail_id?: string | null
  pet?: SessionPet
  owner?: SessionOwner
  plan?: SessionPlan
  [key: string]: unknown
}

/** Debug mode: log GET session payload on step entry and session after Continue. Enable with ?debug=1 or in dev. */
function isSessionDebugMode(): boolean {
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) return true
  if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1") return true
  return false
}

/** Map backend field names to frontend contract. No silent fallbacks for missing data. */
function normalizeSession(data: Record<string, unknown>, sessionId: string): SessionData {
  const walletUrl = (data.wallet_url as string | undefined) ?? (data.wallet_pass_url as string | undefined)
  const out: SessionData = {
    session_id: (data.session_id as string) ?? sessionId,
    card_image_url: data.card_image_url as string | undefined,
    wallet_url: walletUrl,
    wallet_pass_url: (data.wallet_pass_url as string | undefined) ?? walletUrl,
    qr_code_url: data.qr_code_url as string | undefined,
    qr_code_url_android: data.qr_code_url_android as string | undefined,
    insurance_products: Array.isArray(data.insurance_products) ? data.insurance_products : undefined,
    current_step: data.current_step as string | undefined,
    funnel_type: data.funnel_type as string | undefined,
    lead_id: data.lead_id as string | undefined | null,
    quote_detail_id: data.quote_detail_id as string | undefined | null,
  }
  return { ...data, ...out } as SessionData
}

export async function fetchSession(sessionId: string): Promise<SessionData> {
  const url = `${API_BASE}/enroll/session?session_id=${encodeURIComponent(sessionId)}`
  const res = await fetch(url)
  if (!res.ok) {
    let text: string
    try {
      text = await res.text()
    } catch {
      text = `Session fetch failed: ${res.status}`
    }
    throw new Error(text || `Session fetch failed: ${res.status}`)
  }
  let data: Record<string, unknown>
  try {
    data = (await res.json()) as Record<string, unknown>
  } catch {
    throw new Error("Invalid session response")
  }
  if (isSessionDebugMode()) {
    console.log("[DEBUG] GET session payload (step entry or refetch):", JSON.stringify(data, null, 2))
  }
  return normalizeSession(data ?? {}, sessionId)
}

/**
 * Update session step on the backend. Returns updated session; frontend must setSession(returned) (no optimistic merge).
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
  const data = (await res.json()) as Record<string, unknown>
  if (isSessionDebugMode()) {
    console.log("[DEBUG] session after Continue (PATCH response):", JSON.stringify(data, null, 2))
  }
  return normalizeSession(data ?? {}, (data?.session_id as string) ?? sessionId)
}

/**
 * Persist card overlay dismissed so the desktop guided overlay is never shown again for this session.
 */
export async function updateSessionCardOverlayDismissed(sessionId: string): Promise<SessionData> {
  const url = `${API_BASE}/enroll/session`
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, card_overlay_dismissed: true }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Session update failed: ${res.status}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return normalizeSession(data ?? {}, (data?.session_id as string) ?? sessionId)
}

/**
 * Update insurance_products in the session. Optionally persist lead_id and quote_detail_id
 * so "Continue to Details" can call only SetPlan (no second CreateLead).
 * PATCH payload includes session_id, insurance_products, and when provided lead_id and quote_detail_id
 * (verify in DevTools Network that the PATCH request body contains those fields).
 */
export async function updateSessionInsuranceProducts(
  sessionId: string,
  insuranceProducts: unknown[],
  options?: { leadId?: string; quoteDetailId?: string }
): Promise<SessionData> {
  const url = `${API_BASE}/enroll/session`
  const body: Record<string, unknown> = {
    session_id: sessionId,
    insurance_products: insuranceProducts,
    lead_id: options?.leadId ?? undefined,
    quote_detail_id: options?.quoteDetailId ?? undefined,
  }
  
  // Log PATCH payload (dev only)
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    const planIds = insuranceProducts
      .map((p: any) => p?.plan_id)
      .filter(Boolean)
      .slice(0, 5)
    console.log(
      `[updateSessionInsuranceProducts] PATCH /enroll/session:`,
      {
        session_id: sessionId,
        insurance_products_count: insuranceProducts.length,
        plan_ids: planIds,
        lead_id: options?.leadId,
        quote_detail_id: options?.quoteDetailId,
      }
    )
  }
  
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Session update failed: ${res.status}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  return normalizeSession(data ?? {}, (data?.session_id as string) ?? sessionId)
}
