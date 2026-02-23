import * as React from "react"
import { PortalOneModal } from "./PortalOneModal"

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
}

export type OneIncModalLauncherProps = {
  onPaymentSuccess: (result: OneIncPaymentResult) => void
  onPaymentError?: (error: string) => void
  leadId?: string
  accountId?: string
  amount?: number
  oneincModalData?: Record<string, unknown> | null
  disabled?: boolean
}

/**
 * OneInc Payment Launcher – PortalOne session flow.
 * Calls POST /api/oneinc/session to get sessionId (server-side; ONEINC_AUTH_KEY never sent to browser).
 * Renders PortalOneModal with sessionId; listens for postMessage from /api/oneinc/return (Token, TransactionId, Status).
 */
export function OneIncModalLauncher({
  onPaymentSuccess,
  onPaymentError,
  leadId,
  accountId,
  amount,
  disabled = false,
}: OneIncModalLauncherProps) {
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [paymentResult, setPaymentResult] = React.useState<OneIncPaymentResult | null>(null)
  const [isModalOpen, setIsModalOpen] = React.useState(false)
  const [sessionId, setSessionId] = React.useState<string | null>(null)
  const messageHandlerRef = React.useRef<((event: MessageEvent) => void) | null>(null)
  const sessionFetchedRef = React.useRef(false)

  const cleanupMessageListener = React.useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current)
      messageHandlerRef.current = null
    }
  }, [])

  const initializeModal = React.useCallback(async () => {
    if (disabled || isLoading || isModalOpen || sessionId) return

    if (!leadId || !accountId || amount == null || amount <= 0) {
      const errorMsg = "Missing required payment information (leadId, accountId, amount)"
      setError(errorMsg)
      onPaymentError?.(errorMsg)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const sessionUrl = `${API_BASE}/api/oneinc/session`
      console.log("[OneIncModalLauncher] fetch session", sessionUrl)
      const sessionResponse = await fetch(sessionUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          accountId,
          amount,
          referrer: window.location.origin,
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
            convenienceFee: d.convenienceFee != null ? Number(d.convenienceFee) : undefined,
          }
          setPaymentResult(result)
          onPaymentSuccess(result)
          cleanupMessageListener()
          setIsModalOpen(false)
          setSessionId(null)
          setIsLoading(false)
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
            convenienceFee: d.convenienceFee != null ? Number(d.convenienceFee) : undefined,
          }
          setPaymentResult(result)
          onPaymentSuccess(result)
          cleanupMessageListener()
          setIsModalOpen(false)
          setSessionId(null)
          setIsLoading(false)
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
      cleanupMessageListener()
      onPaymentError?.(errorMessage)
    }
  }, [
    leadId,
    accountId,
    amount,
    disabled,
    isLoading,
    isModalOpen,
    sessionId,
    onPaymentSuccess,
    onPaymentError,
    cleanupMessageListener,
  ])

  // Auto-start session and show PortalOne as soon as we have required data (no button)
  React.useEffect(() => {
    if (sessionFetchedRef.current) return
    if (!sessionId && !paymentResult && leadId && accountId && amount != null && amount > 0 && !disabled) {
      sessionFetchedRef.current = true
      initializeModal()
    }
    // Do not reset ref in cleanup — avoids double-fetch under StrictMode. Reset only in handleLaunchModal when user clicks Change.
  }, [sessionId, paymentResult, leadId, accountId, amount, disabled, initializeModal])

  React.useEffect(() => {
    return () => {
      cleanupMessageListener()
    }
  }, [cleanupMessageListener])

  const handleLaunchModal = () => {
    setPaymentResult(null)
    setError(null)
    setSessionId(null)
    setIsModalOpen(false)
    sessionFetchedRef.current = false
    // useEffect will call initializeModal() when sessionId becomes null
  }

  if (paymentResult) {
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
          onClick={handleLaunchModal}
          disabled={disabled}
        >
          Change
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="oneinc-modal-launcher">
        {error && (
          <div className="oneinc-modal-launcher__error" role="alert">
            {error}
          </div>
        )}
        {!sessionId && isLoading && (
          <p className="oneinc-modal-launcher__loading">
            <span className="btn-spinner" aria-hidden />
            Initializing payment…
          </p>
        )}
      </div>

      {sessionId && (
        <PortalOneModal
          sessionId={sessionId}
          amount={amount ?? 0}
          leadId={leadId ?? ""}
          memberId={accountId ?? ""}
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
              convenienceFee: data.convenienceFee,
            }
            setPaymentResult(result)
            onPaymentSuccess(result)
            setIsModalOpen(false)
            setSessionId(null)
            setIsLoading(false)
            cleanupMessageListener()
          }}
        />
      )}
    </>
  )
}
