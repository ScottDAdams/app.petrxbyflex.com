import * as React from "react"

const PORTALONE_SCRIPT_CACHE: Record<string, Promise<void>> = {}
const _initializedSessions = new Set<string>()

function isMobileDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
}

/**
 * Load a script by src once; cache by src so route transitions don't double-load.
 */
function loadScriptOnce(src: string): Promise<void> {
  if (src in PORTALONE_SCRIPT_CACHE) {
    return PORTALONE_SCRIPT_CACHE[src]
  }
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
  PORTALONE_SCRIPT_CACHE[src] = p
  return p
}

const JQUERY_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"

/** PortalOne SDK varies: docs mention tokenId; some builds nest fields under response/gatewayResponse; txn may be authCode. */
function strVal(v: unknown): string {
  if (v == null) return ""
  if (typeof v === "string") return v.trim()
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  if (typeof v === "object" && v !== null && !Array.isArray(v)) {
    const o = v as Record<string, unknown>
    return strVal(o.value ?? o.Value ?? o.token ?? o.Token)
  }
  return ""
}

const NEST_KEYS = [
  "response",
  "Response",
  "gatewayResponse",
  "GatewayResponse",
  "payment",
  "Payment",
  "result",
  "Result",
  "data",
  "Data",
  "portalOne",
  "transaction",
  "Transaction",
  "paymentSummary",
  "PaymentSummary",
  "summary",
  "Summary",
  "paymentSummaryDetail",
  "PaymentSummaryDetail",
]

/** Merge nested objects (two passes) so token/txn can be read from typical ProcessOne shapes. */
function flattenPaymentCompletePayload(data: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = { ...data }
  for (let pass = 0; pass < 2; pass++) {
    for (const k of NEST_KEYS) {
      const v = flat[k]
      if (v && typeof v === "object" && !Array.isArray(v)) {
        for (const [ik, iv] of Object.entries(v as Record<string, unknown>)) {
          if (!(ik in flat)) flat[ik] = iv
        }
      }
    }
  }
  return flat
}

function numVal(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = parseFloat(v.replace(/^\$/, "").trim())
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Only explicit fee / surcharge fields — NOT paymentAmount, totalAmount, or amountSubmitted
 * (those are totals; HP Enrollment API v5 convenienceFee is documented separately).
 */
export const PORTALONE_EXPLICIT_FEE_KEYS = [
  "convenienceFee",
  "ConvenienceFee",
  "totalConvenienceFee",
  "TotalConvenienceFee",
  "fee",
  "Fee",
  "serviceFee",
  "ServiceFee",
  "convenience_fee",
  "feeAmount",
  "FeeAmount",
  "convenience_fee_amount",
] as const

/** Diagnostic only: amount-like fields (never used as convenienceFee). */
export const PORTALONE_AMOUNT_LIKE_KEYS = [
  "amountSubmitted",
  "AmountSubmitted",
  "paymentAmount",
  "totalAmount",
  "totalPaymentAmount",
  "TotalPaymentAmount",
  "minAmountDue",
] as const

/** @deprecated use PORTALONE_EXPLICIT_FEE_KEYS */
export const PORTALONE_FEE_CANDIDATE_KEYS = PORTALONE_EXPLICIT_FEE_KEYS

/** First matching numeric among explicit fee keys only (flattened). */
export function extractConvenienceFeeFromPortalOne(data: Record<string, unknown>): number | undefined {
  const d = flattenPaymentCompletePayload(data)
  for (const k of PORTALONE_EXPLICIT_FEE_KEYS) {
    const n = numVal(d[k])
    if (n !== undefined) return n
  }
  return undefined
}

/** Log helper: values for explicit fee keys + amount-like keys (separate). */
export function collectExplicitFeeFieldSnapshot(data: Record<string, unknown>): {
  explicitFee: Record<string, unknown>
  amountLikeNotUsedAsFee: Record<string, unknown>
} {
  const flat = flattenPaymentCompletePayload(data)
  const explicitFee: Record<string, unknown> = {}
  const amountLikeNotUsedAsFee: Record<string, unknown> = {}
  for (const k of PORTALONE_EXPLICIT_FEE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) explicitFee[`top.${k}`] = (data as Record<string, unknown>)[k]
    if (Object.prototype.hasOwnProperty.call(flat, k)) explicitFee[`flat.${k}`] = flat[k]
  }
  for (const k of PORTALONE_AMOUNT_LIKE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) amountLikeNotUsedAsFee[`top.${k}`] = (data as Record<string, unknown>)[k]
    if (Object.prototype.hasOwnProperty.call(flat, k)) amountLikeNotUsedAsFee[`flat.${k}`] = flat[k]
  }
  return { explicitFee, amountLikeNotUsedAsFee }
}

export type PortalOneFeeDiagnostics = {
  topLevelKeys: string[]
  flatKeys: string[]
  feeFieldValues: Record<string, unknown>
  nestedPaymentSummaries: Record<string, Record<string, unknown>>
}

/** Collect real values for fee-related keys from top + flattened payload + nested payment summaries. */
export function collectPortalOneFeeDiagnostics(data: Record<string, unknown>): PortalOneFeeDiagnostics {
  const flat = flattenPaymentCompletePayload(data)
  const feeFieldValues: Record<string, unknown> = {}
  for (const k of PORTALONE_EXPLICIT_FEE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) feeFieldValues[`explicit.top.${k}`] = (data as Record<string, unknown>)[k]
    if (Object.prototype.hasOwnProperty.call(flat, k)) feeFieldValues[`explicit.flat.${k}`] = flat[k]
  }
  for (const k of PORTALONE_AMOUNT_LIKE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(data, k)) feeFieldValues[`amountLike.top.${k}`] = (data as Record<string, unknown>)[k]
    if (Object.prototype.hasOwnProperty.call(flat, k)) feeFieldValues[`amountLike.flat.${k}`] = flat[k]
  }
  const nestedPaymentSummaries: Record<string, Record<string, unknown>> = {}
  const nestNames = [
    "paymentSummary",
    "PaymentSummary",
    "summary",
    "Summary",
    "payment",
    "Payment",
    "gatewayResponse",
    "GatewayResponse",
  ] as const
  for (const nk of nestNames) {
    const v = data[nk]
    if (v && typeof v === "object" && !Array.isArray(v)) {
      nestedPaymentSummaries[nk] = sanitizePortalOnePaymentComplete(v as Record<string, unknown>)
    }
  }
  return {
    topLevelKeys: Object.keys(data),
    flatKeys: Object.keys(flat),
    feeFieldValues,
    nestedPaymentSummaries,
  }
}

/** JSON-serialize PortalOne payload for server storage (omit functions e.g. acknowledge). */
export function sanitizePortalOnePaymentComplete(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data)) {
    if (k === "acknowledge" && typeof v === "function") continue
    if (typeof v === "function") continue
    try {
      JSON.stringify(v)
      out[k] = v
    } catch {
      /* skip non-serializable */
    }
  }
  return out
}

function extractPaymentTokenAndTxn(data: Record<string, unknown>): { paymentToken: string; transactionId: string } {
  const d = flattenPaymentCompletePayload(data)
  const paymentToken =
    strVal(d.paymentToken) ||
    strVal(d.payment_token) ||
    strVal(d.token) ||
    strVal(d.Token) ||
    strVal(d.tokenId) ||
    strVal(d.TokenId) ||
    strVal(d.tokenID) ||
    strVal(d.vaultToken) ||
    strVal(d.VaultToken) ||
    strVal(d.paymentMethodToken) ||
    strVal(d.PaymentMethodToken) ||
    strVal(d.savedPaymentMethodToken) ||
    strVal(d.paymentMethodId) ||
    strVal(d.PaymentMethodId)
  const transactionId =
    strVal(d.transactionId) ||
    strVal(d.TransactionId) ||
    strVal(d.transaction_id) ||
    strVal(d.referenceNumber) ||
    strVal(d.ReferenceNumber) ||
    strVal(d.transactionReference) ||
    strVal(d.paymentTransactionId) ||
    strVal(d.paymentTransactionID) ||
    strVal(d.authCode) ||
    strVal(d.AuthCode) ||
    strVal(d.authorizationCode) ||
    strVal(d.AuthorizationCode) ||
    strVal(d.traceNumber) ||
    strVal(d.TraceNumber)
  return { paymentToken, transactionId }
}

function ensureJQuery(): Promise<void> {
  if ((window as Window & { jQuery?: unknown }).jQuery) {
    return Promise.resolve()
  }
  return loadScriptOnce(JQUERY_CDN)
}

function getPortalOneScriptUrl(): string {
  const fromEnv = (import.meta.env.VITE_ONEINC_PORTALONE_JS_URL as string)?.trim()
  if (fromEnv) return fromEnv
  const env = (import.meta.env.VITE_ONEINC_ENV as string)?.toLowerCase() || "staging"
  if (env === "prod" || env === "production") {
    return "https://portalone.processonepayments.com/GenericModal/Cdn/PortalOne.js"
  }
  return "https://stgportalone.processonepayments.com/GenericModal/Cdn/PortalOne.js"
}

export type PortalOnePaymentCompletePayload = {
  paymentToken: string
  transactionId: string
  paymentMethod: "CreditCard" | "ECheck"
  /** Not used as HP paymentDetails.convenienceFee; API sets HP_CC_CONVENIENCE_FEE / HP_ECHECK_CONVENIENCE_FEE at enroll */
  convenienceFee?: number
  resolvedConvenienceFee?: number
  /** Runtime fee key values + nested summaries (for HP / debugging) */
  feeDiagnostics?: PortalOneFeeDiagnostics
  billingFirstName?: string
  billingLastName?: string
  billingStreet?: string
  billingCity?: string
  billingState?: string
  billingPostalCode?: string
  /** Sanitized portalOne.paymentComplete extras for debugging (not sent as HP paymentDetails) */
  cardType?: string
  authCode?: string
  holderZip?: string
  rawPortalOne: Record<string, unknown>
}

export type PortalOneModalProps = {
  sessionId: string
  amount: number
  leadId: string
  memberId: string
  onInitError?: (err: Error) => void
  onPaymentComplete?: (data: PortalOnePaymentCompletePayload) => void
}

/**
 * Renders the PortalOne container and initializes the modal with sessionId after the script loads.
 * Script URL: VITE_ONEINC_PORTALONE_JS_URL or derived from VITE_ONEINC_ENV (staging|prod).
 * Init: jQuery $.fn.portalOne if present, else window.portalOne / window.PortalOne.
 */
export function PortalOneModal({ sessionId, amount, leadId, memberId: _memberId, onInitError, onPaymentComplete }: PortalOneModalProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const initLoggedRef = React.useRef(false)
  const iframeObserverRef = React.useRef<MutationObserver | null>(null)

  React.useEffect(() => {
    if (!sessionId) return
    if (_initializedSessions.has(sessionId)) return
    _initializedSessions.add(sessionId)

    const scriptUrl = getPortalOneScriptUrl()
    ensureJQuery()
      .then(() => loadScriptOnce(scriptUrl))
      .then(() => {
        const win = window as Window & {
          jQuery?: { fn?: { portalOne?: (opts: { sessionId: string }) => void }; (el: HTMLElement | null): unknown }
          portalOne?: { init: (opts: { sessionId: string }) => void }
          PortalOne?: { init: (opts: { sessionId: string }) => void }
        }
        const hasJQ = !!win.jQuery
        const hasPlugin = !!(win.jQuery?.fn?.portalOne)
        const keys = Object.keys(win).filter((k) => k.toLowerCase().includes("portal"))
        if (!initLoggedRef.current) {
          console.info("[PortalOne] script loaded", {
            hasJQ,
            hasPlugin,
            keys,
          })
          initLoggedRef.current = true
        }
        console.info("[PortalOne] init", { sessionId })

        const container = containerRef.current
        if (!container) {
          const err = new Error("[PortalOne] container ref not mounted")
          console.error("[PortalOne] init failed", err)
          onInitError?.(err)
          return
        }

        if (hasJQ && hasPlugin && win.jQuery) {
          try {
            const $container = win.jQuery(container) as {
              portalOne: () => void
              data: (key: string) => unknown
            }
            // Step 1: initialize (stores instance in jQuery data)
            $container.portalOne()
            // Move PortalOne's iframe into our container on desktop; on mobile leave on body as native fullscreen modal
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                  if (node instanceof HTMLIFrameElement && node.src?.includes("processonepayments.com")) {
                    if (!isMobileDevice()) {
                      container.appendChild(node)
                    }
                    // On mobile: leave iframe on body as native fullscreen modal
                    observer.disconnect()
                  }
                }
              }
            })
            observer.observe(document.body, { childList: true, subtree: true })
            iframeObserverRef.current = observer
            ;(win.jQuery(container) as { on: (event: string, handler: (evt: unknown, data: Record<string, unknown>) => void) => void }).on("portalOne.paymentComplete", function(_evt: unknown, data: Record<string, unknown>) {
              console.info("[PortalOne] portalOne.paymentComplete (raw reference)", data)
              if (typeof data?.acknowledge === "function") (data.acknowledge as () => void)()
              const rawPortalOne = sanitizePortalOnePaymentComplete(data)
              const feeDiagnostics = collectPortalOneFeeDiagnostics(data)
              const feeSnapshot = collectExplicitFeeFieldSnapshot(data)
              console.info(
                "[PortalOne] explicit fee fields (diagnostic only; HP fee from API enroll)",
                feeSnapshot.explicitFee
              )
              console.info(
                "[PortalOne] amount-like fields (NOT used as convenienceFee; diagnostic only)",
                feeSnapshot.amountLikeNotUsedAsFee
              )
              console.info("[PortalOne] paymentComplete fee diagnostics (full)", feeDiagnostics)
              try {
                const shapeJson = JSON.stringify(rawPortalOne)
                console.info(
                  "[PortalOne] paymentComplete sanitized JSON shape",
                  shapeJson.length > 16000 ? `${shapeJson.slice(0, 16000)}…(truncated ${shapeJson.length} chars)` : shapeJson
                )
              } catch (e) {
                console.warn("[PortalOne] could not JSON.stringify sanitized payload", e)
              }
              const flat = flattenPaymentCompletePayload(data)
              const { paymentToken, transactionId } = extractPaymentTokenAndTxn(data)
              if (!paymentToken || !transactionId) {
                console.error(
                  "[PortalOne] paymentComplete missing token/transactionId after alias map. Keys:",
                  data && typeof data === "object" ? Object.keys(data) : []
                )
                onInitError?.(
                  new Error(
                    "Payment succeeded but token/transaction id were not returned in the expected shape. Check console for portalOne.paymentComplete keys."
                  )
                )
                return
              }
              console.info(
                "[PortalOne] HP paymentDetails.convenienceFee is applied on the server when you enroll — not from this page or any fee lookup from the browser"
              )
              onPaymentComplete?.({
                paymentToken,
                transactionId,
                paymentMethod: data.paymentCategory === "ECheck" ? "ECheck" : "CreditCard",
                feeDiagnostics,
                billingFirstName: (data.billingFirstName as string) || (flat.billingFirstName as string),
                billingLastName: (data.billingLastName as string) || (flat.billingLastName as string),
                billingStreet: (data.billingAddress as string) || (flat.billingStreet as string) || (flat.billingAddress as string),
                billingCity: (data.billingCity as string) || (flat.billingCity as string),
                billingState: (data.billingState as string) || (flat.billingState as string),
                billingPostalCode:
                  (data.billingZip as string) || (flat.billingZip as string) || (flat.billingPostalCode as string) || (flat.holderZip as string),
                cardType: (data.cardType as string) || (flat.cardType as string),
                authCode: (data.authCode as string) || (flat.authCode as string) || (flat.AuthCode as string),
                holderZip: (data.holderZip as string) || (flat.holderZip as string),
                rawPortalOne,
              })
            })
            ;(win.jQuery(container) as { on: (event: string, handler: () => void) => void }).on("portalOne.unload", () => {
              console.info("[PortalOne] portalOne.unload")
            })
            // Step 2: get the instance and call makePayment on it
            const instance = $container.data("portalOne") as {
              makePayment: (opts: Record<string, unknown>) => void
            } | undefined
            if (!instance) throw new Error("[PortalOne] instance not found after init")
            const returnUrl = `${import.meta.env.VITE_API_BASE || "https://api.petrxbyflex.com"}/api/oneinc/return`
            console.info("[PortalOne] calling makePayment", {
              sessionId,
              amount,
              leadId,
              paymentCategory: "UserSelect",
              saveOption: "Save",
              acknowledgmentRequired: "true",
              returnUrl,
            })
            instance.makePayment({
              sessionId,
              paymentCategory: "UserSelect",
              feeContext: 0,
              minAmountDue: amount,
              clientReferenceData1: leadId,
              saveOption: "Save",
              acknowledgmentRequired: "true",
              returnUrl,
            })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        if (win.portalOne?.init) {
          try {
            win.portalOne.init({ sessionId })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        if (win.PortalOne?.init) {
          try {
            win.PortalOne.init({ sessionId })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        const err = new Error(
          "[PortalOne] No API found: expected window.jQuery.fn.portalOne or window.portalOne or window.PortalOne"
        )
        console.error("[PortalOne] init failed", err)
        onInitError?.(err)
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        console.error("[PortalOne] init failed", e)
        onInitError?.(e)
      })

    return () => {
      _initializedSessions.delete(sessionId)
      iframeObserverRef.current?.disconnect()
      iframeObserverRef.current = null
    }
  }, [sessionId, amount, leadId, onInitError, onPaymentComplete])

  return (
    <div
      id="portalOneContainer"
      ref={containerRef}
      className="portal-one-container"
      style={
        isMobileDevice()
          ? {}
          : {
              position: "relative",
              width: "100%",
              height: "950px",
              overflow: "hidden",
              transform: "translateZ(0)",
            }
      }
    />
  )
}
