import * as React from "react"
import {
  PortalOneModal,
  type PortalOneFeeDiagnostics,
  getOneIncModalVersion,
} from "./PortalOneModal"
import { persistOneIncCompletion, type OneIncCompleteApiResponse } from "../../api/oneinc"

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.petrxbyflex.com"
const BUILD_VERSION = "oneinc-portalone-session-v1-" + Date.now()
console.log("[OneIncModalLauncher] Loaded version:", BUILD_VERSION)

/** Allowed origins for postMessage from returnUrl (our API) or OneInc staging */
const ALLOWED_MESSAGE_ORIGINS = [
  "https://api.petrxbyflex.com",
  "https://stgportalone.processonepayments.com",
]

export type OneIncPaymentResult = {
  paymentToken: string
  transactionId: string
  paymentMethod?: "CreditCard" | "ECheck"
  convenienceFee?: number
  resolvedConvenienceFee?: number
  feeDiagnostics?: PortalOneFeeDiagnostics
  cardType?: string
  authCode?: string
  holderZip?: string
  /** Sanitized portalOne.paymentComplete for session/audit (not HP paymentDetails) */
  rawPortalOne?: Record<string, unknown>
  /**
   * Full JSON body from POST /api/oneinc/complete (after durable persist succeeds).
   * Required for HP Enroll: paymentDetails.fullPaymentResponse = JSON.stringify(this object).
   * Official HP docs omit this field; staging requires it. Do not replace with payment.raw only.
   */
  oneIncCompleteResponse?: OneIncCompleteApiResponse
}

export type OneIncModalLauncherProps = {
  onPaymentSuccess: (result: OneIncPaymentResult) => void
  onPaymentError?: (error: string) => void
  leadId?: string
  accountId?: string
  amount?: number
  oneincModalData?: Record<string, unknown> | null
  disabled?: boolean
  /** PetRx enrollment session UUID — used to POST /api/oneinc/complete after OneInc success */
  enrollmentSessionId?: string
  /** When true (e.g. session rehydrated from DB), do not auto-open OneInc; show success UI */
  paymentAlreadyComplete?: boolean
  /** Called after durable persist succeeds (e.g. refetch GET /enroll/session) */
  onPersistedSuccess?: () => void | Promise<void>
  /** Threaded into OneInc V2 ``makePayment`` for card / zip pre-fill */
  customerFullName?: string
  billingZip?: string
  billingAddressStreet?: string
}

/**
 * OneInc Payment Launcher – PortalOne session flow.
 * Calls POST /api/oneinc/session to get sessionId (server-side; ONEINC_AUTH_KEY never sent to browser).
 * Renders PortalOneModal with sessionId; listens for postMessage from /api/oneinc/return (Token, TransactionId, Status).
 *
 * **Healthy Paws production order** (www.healthypawspetinsurance.com): OneInc opens immediately and runs
 * NOTICE → portal “MAKE A PAYMENT” summary → PAYMENT TYPE / card. We do **not** inject a React modal before OneInc.
 */
export function OneIncModalLauncher({
  onPaymentSuccess,
  onPaymentError,
  leadId,
  accountId,
  amount,
  disabled = false,
  enrollmentSessionId,
  paymentAlreadyComplete = false,
  onPersistedSuccess,
  customerFullName,
  billingZip,
  billingAddressStreet,
}: OneIncModalLauncherProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [paymentResult, setPaymentResult] = React.useState<OneIncPaymentResult | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  /**
   * After ``portalOne.unload`` without payment, we stop auto-starting until the user
   * clicks “Reopen payment” (mirrors recovery UX; initial visit still auto-starts).
   */
  const [closedWithoutPayment, setClosedWithoutPayment] = React.useState(false)
  const messageHandlerRef = React.useRef<((event: MessageEvent) => void) | null>(null)
  const sessionFetchedRef = React.useRef(false)

  const cleanupMessageListener = React.useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current)
      messageHandlerRef.current = null
    }
  }, [])

  const finalizePaymentSuccess = React.useCallback(
    async (result: OneIncPaymentResult) => {
      const pt = result.paymentToken?.trim?.() ?? String(result.paymentToken ?? "").trim()
      const tid = result.transactionId?.trim?.() ?? String(result.transactionId ?? "").trim()
      if (!pt || !tid) {
        const msg =
          "Payment reported success but vault token or transaction id was missing. See console for portalOne.paymentComplete payload."
        setError(msg)
        onPaymentError?.(msg)
        return
      }
      const normalized: OneIncPaymentResult = {
        ...result,
        paymentToken: pt,
        transactionId: tid,
        convenienceFee: undefined,
        resolvedConvenienceFee: undefined,
      }
      if (enrollmentSessionId) {
        try {
          const r = await persistOneIncCompletion({
            session_id: enrollmentSessionId,
            paymentToken: normalized.paymentToken,
            transactionId: normalized.transactionId,
            paymentMethod: normalized.paymentMethod,
            status: "Approved",
            raw: {
              source: "portalOne.paymentComplete",
              portalOnePaymentComplete: normalized.rawPortalOne ?? {},
              feeDiagnostics: normalized.feeDiagnostics,
              normalized: {
                paymentToken: normalized.paymentToken,
                transactionId: normalized.transactionId,
                paymentMethod: normalized.paymentMethod,
                cardType: normalized.cardType,
                authCode: normalized.authCode,
                holderZip: normalized.holderZip,
              },
            },
          })
          if (r.error) {
            setError(r.error)
            onPaymentError?.(r.error)
            return
          }
          /** Full /api/oneinc/complete response — stringify entire object for HP enroll fullPaymentResponse */
          const { error: _omitErr, ...completeRest } = r as Record<string, unknown> & { error?: string }
          void _omitErr
          normalized.oneIncCompleteResponse = completeRest as OneIncCompleteApiResponse
          await onPersistedSuccess?.()
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Payment save failed"
          setError(msg)
          onPaymentError?.(msg)
          return
        }
      }
      setPaymentResult(normalized)
      onPaymentSuccess(normalized)
      cleanupMessageListener()
      setIsModalOpen(false)
      setSessionId(null)
      setIsLoading(false)
      setClosedWithoutPayment(false)
    },
    [enrollmentSessionId, onPaymentSuccess, onPaymentError, onPersistedSuccess, cleanupMessageListener]
  )

  const initializeModal = React.useCallback(async () => {
    if (paymentAlreadyComplete) return
    if (disabled || isLoading || isModalOpen || sessionId) return

    if (!leadId || !accountId || amount == null || amount <= 0) {
      const errorMsg = "Missing required payment information (leadId, accountId, amount)"
      setError(errorMsg)
      sessionFetchedRef.current = false
      onPaymentError?.(errorMsg)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const sessionUrl = `${API_BASE}/api/oneinc/session`
      console.log("[OneIncModalLauncher] fetch session", sessionUrl)
      const modalVersion = getOneIncModalVersion()
      const sessionResponse = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          accountId,
          amount,
          referrer: window.location.origin,
          modalVersion,
        }),
      })

      const data = await sessionResponse.json().catch(() => ({}))
      console.log("[OneIncModalLauncher] session response status:", sessionResponse.status)
      console.log("[OneIncModalLauncher] session response JSON:", data)

      if (!sessionResponse.ok) {
        const errCode = data?.error
        const requestId = data?.requestId
        const upstreamStatus = data?.upstreamStatus
        const snippet = data?.upstreamBodySnippet
        const errorMsg =
          errCode === "ONEINC_SESSION_CREATE_FAILED"
            ? `Session create failed. requestId=${requestId ?? "—"} upstreamStatus=${upstreamStatus ?? "—"} snippet=${(snippet ?? "").slice(0, 100)}`
            : data?.message || `OneInc session failed: ${sessionResponse.status}`
        setError(errorMsg)
        setIsLoading(false)
        sessionFetchedRef.current = false
        onPaymentError?.(errorMsg)
        return
      }

      const sid = data?.sessionId ?? data?.session_id
      if (!sid || typeof sid !== "string") {
        const errorMsg =
          "Invalid session response: sessionId is required. Response: " + JSON.stringify(data)
        console.error("[OneIncModalLauncher] sessionId missing. Full response:", data)
        setError(errorMsg)
        setIsLoading(false)
        sessionFetchedRef.current = false
        onPaymentError?.(errorMsg)
        return
      }

      cleanupMessageListener()

      const allowedOrigins = ALLOWED_MESSAGE_ORIGINS
      const messageHandler = (event: MessageEvent) => {
        if (!allowedOrigins.includes(event.origin) && event.origin !== "null") {
          return
        }
        const d = event.data
        const msgType = d?.type

        if (msgType === "ONEINC_PAYMENT_COMPLETE") {
          console.log("[OneIncModalLauncher] ONEINC_PAYMENT_COMPLETE payload:", d)
          const paymentToken = d.token ?? d.paymentToken
          const transactionId = d.transactionId
          if (!paymentToken || !transactionId) {
            setError("Invalid payment response: missing token or transactionId")
            onPaymentError?.("Invalid payment response")
            cleanupMessageListener()
            setIsModalOpen(false)
            setSessionId(null)
            setIsLoading(false)
            return
          }
          const result: OneIncPaymentResult = {
            paymentToken,
            transactionId,
            paymentMethod: d.paymentMethod === "ECheck" ? "ECheck" : "CreditCard",
          }
          void finalizePaymentSuccess(result)
          return
        }

        if (msgType === "ONEINC_SUCCESS" || msgType === "ONEINC_ERROR") {
          console.log("[OneIncModalLauncher] postMessage payload:", {
            type: msgType,
            Token: d.paymentToken,
            TransactionId: d.transactionId,
            Status: msgType === "ONEINC_SUCCESS" ? "Success" : d.error,
          })
        }
        if (msgType === "ONEINC_SUCCESS") {
          const paymentToken = d.paymentToken
          const transactionId = d.transactionId
          if (!paymentToken || !transactionId) {
            setError("Invalid payment response")
            onPaymentError?.("Invalid payment response")
            cleanupMessageListener()
            setIsModalOpen(false)
            setSessionId(null)
            setIsLoading(false)
            return
          }
          const result: OneIncPaymentResult = {
            paymentToken,
            transactionId,
            paymentMethod: d.paymentMethod === "ECheck" ? "ECheck" : "CreditCard",
          }
          void finalizePaymentSuccess(result)
          return
        }
        if (msgType === "ONEINC_ERROR") {
          const errorMsg = d.error || "Payment processing failed"
          setError(errorMsg)
          onPaymentError?.(errorMsg)
          cleanupMessageListener()
          setIsModalOpen(false)
          setSessionId(null)
          setIsLoading(false)
        }
      }

      messageHandlerRef.current = messageHandler
      window.addEventListener("message", messageHandler)

      setSessionId(sid)
      setIsModalOpen(true)
      setIsLoading(false)
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to initialize payment modal"
      setError(errorMessage)
      setIsLoading(false)
      sessionFetchedRef.current = false
      cleanupMessageListener()
      onPaymentError?.(errorMessage)
    }
  }, [
    paymentAlreadyComplete,
    leadId,
    accountId,
    amount,
    disabled,
    isLoading,
    isModalOpen,
    sessionId,
    onPaymentError,
    cleanupMessageListener,
    finalizePaymentSuccess,
  ])

  // Auto-start: mint session and mount PortalOne as soon as prerequisites are met.
  // If the user closed OneInc without paying, ``closedWithoutPayment`` gates further
  // auto-starts until they click “Reopen payment” (flips false and clears the ref).
  React.useEffect(() => {
    if (paymentAlreadyComplete) return
    if (closedWithoutPayment) return
    if (sessionFetchedRef.current) return
    if (!sessionId && !paymentResult && leadId && accountId && amount != null && amount > 0 && !disabled) {
      sessionFetchedRef.current = true
      void initializeModal()
    }
  }, [
    closedWithoutPayment,
    paymentAlreadyComplete,
    sessionId,
    paymentResult,
    leadId,
    accountId,
    amount,
    disabled,
    initializeModal,
  ])

  React.useEffect(() => {
    return () => {
      cleanupMessageListener()
    }
  }, [cleanupMessageListener])

  const handleReopenPayment = React.useCallback(() => {
    setError(null)
    setClosedWithoutPayment(false)
    sessionFetchedRef.current = false
  }, [])

  const handleChangePayment = React.useCallback(() => {
    setPaymentResult(null)
    setError(null)
    setSessionId(null)
    setClosedWithoutPayment(false)
    sessionFetchedRef.current = false
  }, [])

  if (paymentAlreadyComplete || paymentResult) {
    return (
      <div className="oneinc-payment-success">
        <div className="oneinc-payment-success__content">
          <svg
            className="oneinc-payment-success__icon"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="M16.667 5L7.5 14.167 3.333 10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="oneinc-payment-success__text">Payment method added successfully</span>
        </div>
        <button
          type="button"
          className="oneinc-payment-success__change"
          onClick={handleChangePayment}
          disabled={disabled || paymentAlreadyComplete}
          title={
            paymentAlreadyComplete
              ? "Replacing saved payment is not supported yet (TODO: phase 2)"
              : undefined
          }
        >
          Change
        </button>
      </div>
    )
  }

  const required = !!leadId && !!accountId && amount != null && amount > 0

  return (
    <>
      <div className="oneinc-modal-launcher">
        {error && (
          <div className="oneinc-modal-launcher__error" role="alert">
            {error}
          </div>
        )}
        {isLoading && !sessionId && (
          <p className="oneinc-modal-launcher__loading">
            <span className="btn-spinner" aria-hidden />
            Initializing payment…
          </p>
        )}
        {closedWithoutPayment && !isLoading && !sessionId && required && (
          <div className="oneinc-modal-launcher__reopen">
            <p className="oneinc-modal-launcher__reopen-text">
              Payment was canceled. Reopen the payment window to continue.
            </p>
            <button type="button" className="btn btn--primary" onClick={handleReopenPayment} disabled={disabled}>
              Reopen payment
            </button>
          </div>
        )}
      </div>

      {sessionId && (
        <PortalOneModal
          sessionId={sessionId}
          amount={amount ?? 0}
          leadId={leadId ?? ""}
          memberId={accountId ?? ""}
          policyHolderName={customerFullName || undefined}
          billingZip={billingZip}
          billingAddressStreet={billingAddressStreet}
          onInitError={(err) => {
            console.error("[PortalOne] init failed", err)
            setError(err.message)
            onPaymentError?.(err.message)
          }}
          onPaymentComplete={(data) => {
            const result: OneIncPaymentResult = {
              paymentToken: data.paymentToken,
              transactionId: data.transactionId,
              paymentMethod: data.paymentMethod,
              feeDiagnostics: data.feeDiagnostics,
              cardType: data.cardType,
              authCode: data.authCode,
              holderZip: data.holderZip,
              rawPortalOne: data.rawPortalOne,
            }
            void finalizePaymentSuccess(result)
          }}
          onClose={() => {
            cleanupMessageListener()
            setIsModalOpen(false)
            setSessionId(null)
            setClosedWithoutPayment(true)
            sessionFetchedRef.current = false
          }}
        />
      )}
    </>
  )
}
