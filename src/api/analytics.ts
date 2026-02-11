import { API_BASE } from "./index"

const DEBUG = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("debug") === "1"

export type EnrollmentEventName =
  | "card_overlay_shown"
  | "card_overlay_dismissed"
  | "wallet_add_clicked"
  | "card_image_download_clicked"
  | "insurance_teaser_expand_clicked"
  | "insurance_cta_clicked"

export type EnrollmentEventMetadata = {
  session_id?: string
  member_id?: string
  current_step?: string
  layout?: string
  viewport_bucket?: "desktop" | "mobile"
  dismiss_reason?: "click" | "esc" | "timeout"
  ts?: string
  [key: string]: unknown
}

/**
 * Fire a first-party enrollment analytics event. Fails silently (no throw, no UX block).
 */
export function trackEnrollmentEvent(eventName: EnrollmentEventName, metadata: EnrollmentEventMetadata = {}): void {
  const { session_id, member_id, current_step, layout, viewport_bucket, ...rest } = metadata
  const payload = {
    event_name: eventName,
    session_id: session_id ?? undefined,
    member_id: member_id ?? undefined,
    step: current_step ?? metadata.step ?? undefined,
    layout: layout ?? undefined,
    viewport_bucket: viewport_bucket ?? undefined,
    metadata: { ...rest, ts: metadata.ts ?? new Date().toISOString() },
  }
  if (DEBUG) {
    console.log("[Enrollment event]", eventName, payload)
  }
  fetch(`${API_BASE}/api/analytics/event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Fail silently
  })
}
