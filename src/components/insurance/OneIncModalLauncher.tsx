import * as React from "react"

const API_BASE = import.meta.env.VITE_API_BASE || "https://api.petrxbyflex.com"
// Version identifier for deployment verification
const BUILD_VERSION = "oneinc-iframe-v1-" + Date.now()
console.log("[OneIncModalLauncher] Loaded version:", BUILD_VERSION)

export type OneIncPaymentResult = {
  paymentToken: string
  transactionId: string
  paymentMethod?: "CreditCard" | "ECheck"
  convenienceFee?: number
}

export type OneIncModalLauncherProps = {
  onPaymentSuccess: (result: OneIncPaymentResult) => void
  onPaymentError?: (error: string) => void
  leadId?: string  // HP leadId (maps to OneInc customerId)
  accountId?: string  // HP accountId from SetupPending (maps to OneInc policyId)
  amount?: number
  disabled?: boolean
}

/**
 * OneInc Modal Launcher Component
 * 
 * Opens OneInc hosted payment modal in an iframe dialog overlay.
 * The modal handles all PCI-sensitive card data collection.
 * 
 * Based on HAR analysis: OneInc uses hosted modal URL that establishes
 * session/auth via cookies. Modal makes calls to:
 * - /gm2card/getconveniencefeeslist (calculates fee)
 * - /gm2card/charge (processes payment)
 * 
 * On success, returns paymentToken, transactionId, convenienceFee, and paymentMethod.
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
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null)
  const messageHandlerRef = React.useRef<((event: MessageEvent) => void) | null>(null)

  // Get allowed origin for postMessage (API_BASE origin for returnUrl handler)
  const getAllowedOrigin = React.useCallback(() => {
    try {
      const apiUrl = new URL(API_BASE)
      return apiUrl.origin
    } catch {
      return null
    }
  }, [])

  // Clean up message listener
  const cleanup = React.useCallback(() => {
    if (messageHandlerRef.current) {
      window.removeEventListener("message", messageHandlerRef.current)
      messageHandlerRef.current = null
    }
  }, [])

  // Initialize OneInc hosted modal
  const initializeModal = React.useCallback(async () => {
    if (disabled || isLoading || isModalOpen) return

    if (!leadId || !accountId || !amount) {
      const errorMsg = "Missing required payment information (leadId, accountId, amount)"
      setError(errorMsg)
      if (onPaymentError) {
        onPaymentError(errorMsg)
      }
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      console.log("[OneIncModalLauncher] Calling /api/oneinc/init", { leadId, accountId, amount, referrer: window.location.origin })
      // Get OneInc hosted modal URL from backend
      const initResponse = await fetch(`${API_BASE}/api/oneinc/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId,
          accountId,
          amount,
          referrer: window.location.origin,
        }),
      })
      console.log("[OneIncModalLauncher] /api/oneinc/init response:", initResponse.status, initResponse.ok)

      if (!initResponse.ok) {
        const errorData = await initResponse.json().catch(() => ({}))
        const errorMsg = errorData.message || `OneInc init failed: ${initResponse.status}`
        setError(errorMsg)
        setIsLoading(false)
        if (onPaymentError) {
          onPaymentError(errorMsg)
        }
        return
      }

      const initData = await initResponse.json().catch(() => ({}))
      const url = initData.modalUrl

      if (!url || typeof url !== "string") {
        const errorMsg = "Invalid init response: modalUrl is required"
        setError(errorMsg)
        setIsLoading(false)
        if (onPaymentError) {
          onPaymentError(errorMsg)
        }
        return
      }

      // Clean up any existing listener
      cleanup()

      // Set up postMessage listener for returnUrl callback
      const allowedOrigin = getAllowedOrigin()
      const messageHandler = (event: MessageEvent) => {
        // Validate origin - only accept from API_BASE (returnUrl handler)
        if (!allowedOrigin || event.origin !== allowedOrigin) {
          console.warn("[OneIncModalLauncher] Rejected message from unauthorized origin:", event.origin, "expected:", allowedOrigin)
          return
        }

        // Handle success message from returnUrl handler
        if (event.data?.type === "ONEINC_SUCCESS") {
          const { paymentToken, transactionId, paymentMethod, convenienceFee } = event.data
          if (!paymentToken || !transactionId) {
            console.error("[OneIncModalLauncher] Invalid success message:", event.data)
            setError("Invalid payment response")
            if (onPaymentError) {
              onPaymentError("Invalid payment response")
            }
            cleanup()
            setIsModalOpen(false)
            setIsLoading(false)
            return
          }

          const result: OneIncPaymentResult = {
            paymentToken,
            transactionId,
            paymentMethod: paymentMethod === "ECheck" ? "ECheck" : "CreditCard",
            convenienceFee: convenienceFee ? parseFloat(String(convenienceFee)) : undefined,
          }

          setPaymentResult(result)
          onPaymentSuccess(result)
          cleanup()
          setIsModalOpen(false)
          setIsLoading(false)
          return
        }

        // Handle error message
        if (event.data?.type === "ONEINC_ERROR") {
          const errorMsg = event.data.error || "Payment processing failed"
          setError(errorMsg)
          if (onPaymentError) {
            onPaymentError(errorMsg)
          }
          cleanup()
          setIsModalOpen(false)
          setIsLoading(false)
          return
        }
      }

      messageHandlerRef.current = messageHandler
      window.addEventListener("message", messageHandler)

      // Open modal with iframe
      setModalUrl(url)
      setIsModalOpen(true)
      setIsLoading(false)
    } catch (err) {
      // Catch any unexpected errors - never throw, always use callbacks
      const errorMessage = err instanceof Error ? err.message : "Failed to initialize payment modal"
      setError(errorMessage)
      setIsLoading(false)
      cleanup()
      if (onPaymentError) {
        onPaymentError(errorMessage)
      }
    }
  }, [leadId, accountId, amount, disabled, isLoading, isModalOpen, onPaymentSuccess, onPaymentError, cleanup, getAllowedOrigin])

  // Close modal handler
  const closeModal = React.useCallback(() => {
    setIsModalOpen(false)
    setModalUrl(null)
    cleanup()
  }, [cleanup])

  // Cleanup on unmount
  React.useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  const handleLaunchModal = () => {
    console.log("[OneIncModalLauncher] handleLaunchModal called", { leadId, accountId, amount, disabled, isLoading })
    if (paymentResult) {
      // Allow changing payment method
      setPaymentResult(null)
      setError(null)
    }
    initializeModal()
  }

  if (paymentResult) {
    return (
      <div className="oneinc-payment-success">
        <div className="oneinc-payment-success__content">
          <svg className="oneinc-payment-success__icon" width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M16.667 5L7.5 14.167 3.333 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
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

      {/* Modal overlay with iframe */}
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
            zIndex: 10000,
          }}
          onClick={(e) => {
            // Close on backdrop click
            if (e.target === e.currentTarget) {
              closeModal()
            }
          }}
        >
          <div
            className="oneinc-modal-container"
            style={{
              position: "relative",
              width: "90%",
              maxWidth: "520px",
              height: "90%",
              maxHeight: "720px",
              backgroundColor: "white",
              borderRadius: "8px",
              overflow: "hidden",
              boxShadow: "0 4px 20px rgba(0, 0, 0, 0.3)",
            }}
          >
            <button
              type="button"
              onClick={closeModal}
              style={{
                position: "absolute",
                top: "8px",
                right: "8px",
                zIndex: 10001,
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
            <iframe
              ref={iframeRef}
              src={modalUrl}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
              }}
              title="OneInc Payment Modal"
              allow="payment"
            />
          </div>
        </div>
      )}
    </>
  )
}
