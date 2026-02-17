import * as React from "react"

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.petrxbyflex.com"
const BUILD_VERSION = "oneinc-iframe-v1-" + Date.now()
/** Seconds to wait before auto-fallback to popup if iframe shows no payment activity */
const FALLBACK_DELAY_MS = 5000
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
 * OneInc Payment Launcher – hosted modal iframe flow.
 * Calls POST /api/oneinc/init to get modalUrl, loads it in an iframe, listens for
 * postMessage from /api/oneinc/return (Token, TransactionId, Status).
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
  const [modalUrl, setModalUrl] = React.useState<string | null>(null)
  /** Set when iframe load succeeds but contentWindow access throws (X-Frame-Options / CSP). */
  const [frameBlocked, setFrameBlocked] = React.useState(false)
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const messageHandlerRef = React.useRef<((event: MessageEvent) => void) | null>(null)
  const paymentReceivedRef = React.useRef(false)
  const fallbackUsedRef = React.useRef(false)

  const cleanupMessageListener = React.useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current)
      messageHandlerRef.current = null
    }
  }, [])

  const initializeModal = React.useCallback(async () => {
    if (disabled || isLoading || isModalOpen) return

    if (!leadId || !accountId || amount == null || amount <= 0) {
      const errorMsg = "Missing required payment information (leadId, accountId, amount)"
      setError(errorMsg)
      onPaymentError?.(errorMsg)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const initUrl = `${API_BASE}/api/oneinc/init`
      console.log("[OneIncModalLauncher] fetch init", initUrl)
      const initResponse = await fetch(initUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          accountId,
          amount,
          referrer: window.location.origin,
        }),
      })

      const xOneIncInit = initResponse.headers.get("X-OneInc-Init")
      const data = await initResponse.json().catch(() => ({}))
      console.log("[OneIncModalLauncher] init response status:", initResponse.status)
      console.log("[OneIncModalLauncher] init response header X-OneInc-Init:", xOneIncInit)
      console.log("[OneIncModalLauncher] init response JSON:", data)

      if (!initResponse.ok) {
        const errorMsg = data.message || `OneInc init failed: ${initResponse.status}`
        setError(errorMsg)
        setIsLoading(false)
        onPaymentError?.(errorMsg)
        return
      }

      // E) Single contract: backend must return hosted-modal URL (modalUrl). Reject old shape.
      if (data?.portalOneSessionKey != null || data?.monthlySubtotal != null) {
        const errorMsg =
          "Server returned old OneInc format (portalOneSessionKey/monthlySubtotal). " +
          "Ensure backend returns modalUrl only and correct route is deployed."
        console.error("[OneIncModalLauncher] Old response shape detected. Wrong route or wrong deployed code. Response:", data)
        setError(errorMsg)
        setIsLoading(false)
        onPaymentError?.(errorMsg)
        return
      }

      if (!data?.modalUrl || typeof data.modalUrl !== "string") {
        const errorMsg =
          "Invalid init response: modalUrl is required. " +
          `X-OneInc-Init: ${xOneIncInit ?? "null"}. Response: ${JSON.stringify(data)}`
        console.error("[OneIncModalLauncher] modalUrl missing. Full response:", data)
        console.error("[OneIncModalLauncher] X-OneInc-Init:", xOneIncInit)
        setError(errorMsg)
        setIsLoading(false)
        onPaymentError?.(errorMsg)
        return
      }

      const url = data.modalUrl
      cleanupMessageListener()

      const allowedOrigins = ALLOWED_MESSAGE_ORIGINS
      const messageHandler = (event: MessageEvent) => {
        if (!allowedOrigins.includes(event.origin) && event.origin !== "null") {
          return
        }
        const d = event.data
        const msgType = d?.type

        // ONEINC_PAYMENT_COMPLETE: from return page (token, transactionId, status)
        if (msgType === "ONEINC_PAYMENT_COMPLETE") {
          console.log("[OneIncModalLauncher] ONEINC_PAYMENT_COMPLETE payload:", d)
          paymentReceivedRef.current = true
          const paymentToken = d.token ?? d.paymentToken
          const transactionId = d.transactionId
          if (!paymentToken || !transactionId) {
            setError("Invalid payment response: missing token or transactionId")
            onPaymentError?.("Invalid payment response")
            cleanupMessageListener()
            setIsModalOpen(false)
            setModalUrl(null)
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
          setModalUrl(null)
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
          paymentReceivedRef.current = true
          const paymentToken = d.paymentToken
          const transactionId = d.transactionId
          if (!paymentToken || !transactionId) {
            setError("Invalid payment response")
            onPaymentError?.("Invalid payment response")
            cleanupMessageListener()
            setIsModalOpen(false)
            setModalUrl(null)
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
          setModalUrl(null)
          setIsLoading(false)
          return
        }
        if (msgType === "ONEINC_ERROR") {
          const errorMsg = d.error || "Payment processing failed"
          setError(errorMsg)
          onPaymentError?.(errorMsg)
          cleanupMessageListener()
          setIsModalOpen(false)
          setModalUrl(null)
          setIsLoading(false)
        }
      }

      messageHandlerRef.current = messageHandler
      window.addEventListener("message", messageHandler)

      paymentReceivedRef.current = false
      fallbackUsedRef.current = false
      setFrameBlocked(false)
      setModalUrl(url)
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
    onPaymentSuccess,
    onPaymentError,
    cleanupMessageListener,
  ])

  const openInNewTab = React.useCallback(() => {
    if (modalUrl) window.open(modalUrl, "_blank", "noopener,noreferrer")
  }, [modalUrl])

  const copyModalUrl = React.useCallback(() => {
    if (modalUrl) {
      void navigator.clipboard.writeText(modalUrl)
      console.log("[OneIncModalLauncher] Copied modalUrl to clipboard")
    }
  }, [modalUrl])

  const reloadIframe = React.useCallback(() => {
    if (iframeRef.current && modalUrl) {
      iframeRef.current.src = modalUrl
      console.log("[OneIncModalLauncher] iframe reloaded")
    }
  }, [modalUrl])

  const closeModal = React.useCallback(() => {
    setIsModalOpen(false)
    setModalUrl(null)
    setFrameBlocked(false)
    cleanupMessageListener()
  }, [cleanupMessageListener])

  React.useEffect(() => {
    return () => {
      cleanupMessageListener()
    }
  }, [cleanupMessageListener])

  // D) Fallback to popup after N seconds if no payment activity (or frame blocked elsewhere)
  React.useEffect(() => {
    if (!isModalOpen || !modalUrl) return
    const t = window.setTimeout(() => {
      if (paymentReceivedRef.current || fallbackUsedRef.current) return
      fallbackUsedRef.current = true
      console.log("[OneIncModalLauncher] Fallback: opening modalUrl in new tab after", FALLBACK_DELAY_MS, "ms")
      window.open(modalUrl, "_blank", "noopener,noreferrer")
    }, FALLBACK_DELAY_MS)
    return () => window.clearTimeout(t)
  }, [isModalOpen, modalUrl])

  const handleLaunchModal = () => {
    if (paymentResult) {
      setPaymentResult(null)
      setError(null)
    }
    initializeModal()
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
        <button
          type="button"
          className="oneinc-modal-launcher__button"
          onClick={handleLaunchModal}
          disabled={disabled || isLoading}
        >
          {isLoading ? (
            <>
              <span className="btn-spinner" aria-hidden />
              Initializing...
            </>
          ) : (
            "Continue to payment"
          )}
        </button>
        <p className="oneinc-modal-launcher__note">
          Secure payment processing powered by OneInc
        </p>
      </div>

      {isModalOpen && modalUrl && (
        <div
          className="oneinc-modal-overlay"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            pointerEvents: "auto",
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div
            className="oneinc-modal-container"
            style={{
              position: "relative",
              width: "100%",
              maxWidth: "900px",
              minHeight: "720px",
              backgroundColor: "white",
              borderRadius: "8px",
              overflow: "hidden",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
              pointerEvents: "auto",
            }}
          >
            <button
              type="button"
              onClick={closeModal}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                zIndex: 10000,
                background: "rgba(0, 0, 0, 0.5)",
                color: "white",
                border: "none",
                borderRadius: "50%",
                width: "32px",
                height: "32px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "20px",
                lineHeight: "1",
              }}
              aria-label="Close payment modal"
            >
              ×
            </button>

            {/* A) Debug harness: modalUrl + Open / Copy / Reload */}
            <div
              style={{
                padding: "8px 12px",
                background: "#f0f0f0",
                borderBottom: "1px solid #ccc",
                fontSize: "12px",
                wordBreak: "break-all",
              }}
            >
              <div style={{ marginBottom: "6px", fontWeight: 600 }}>modalUrl</div>
              <div style={{ marginBottom: "8px", color: "#333" }}>{modalUrl}</div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button type="button" onClick={openInNewTab} style={{ padding: "4px 8px" }}>
                  Open modalUrl in new tab
                </button>
                <button type="button" onClick={copyModalUrl} style={{ padding: "4px 8px" }}>
                  Copy modalUrl
                </button>
                <button type="button" onClick={reloadIframe} style={{ padding: "4px 8px" }}>
                  Reload iframe
                </button>
              </div>
            </div>

            {/* C) Frame-blocked state: X-Frame-Options / CSP → popup flow */}
            {frameBlocked && (
              <div
                role="alert"
                style={{
                  padding: "12px",
                  background: "#fff3cd",
                  borderBottom: "1px solid #ffc107",
                  fontSize: "13px",
                }}
              >
                Frame blocked (X-Frame-Options or CSP). Opened payment in new tab. You can close this overlay.
              </div>
            )}

            {/* B) Sandbox removed for test deploy. To re-add minimal: allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation */}
            <iframe
              ref={iframeRef}
              src={modalUrl}
              title="OneInc Payment Modal"
              allow="payment *; fullscreen *; clipboard-read *; clipboard-write *"
              style={{
                width: "100%",
                height: "700px",
                border: "none",
                display: "block",
              }}
              onLoad={() => {
                console.log("[OneIncModalLauncher] OneInc iframe loaded")
                const iframe = iframeRef.current
                if (!iframe) return
                try {
                  const href = iframe.contentWindow?.location?.href
                  console.log("[OneIncModalLauncher] iframe contentWindow.location.href:", href)
                } catch (e) {
                  console.warn(
                    "[OneIncModalLauncher] iframe contentWindow access failed (cross-origin or blocked):",
                    e
                  )
                  setFrameBlocked(true)
                  if (!fallbackUsedRef.current) {
                    fallbackUsedRef.current = true
                    window.open(modalUrl, "_blank", "noopener,noreferrer")
                  }
                }
              }}
              onError={(e) => {
                console.error("[OneIncModalLauncher] OneInc iframe onError:", e)
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
