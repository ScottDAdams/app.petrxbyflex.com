import * as React from "react"
import { createPortal } from "react-dom"

export type ConfirmPaymentModalProps = {
  customerFirstName?: string
  customerFullName?: string
  amount: number
  onContinue: () => void
  onCancel?: () => void
  disabled?: boolean
  /** Optional override for the headline copy. Defaults to "MAKE A PAYMENT". */
  title?: string
}

/**
 * HP-style pre-payment summary card.
 *
 * Mirrors Healthy Paws' /enrollment/step4 modal: full-page dim with a centered
 * card showing a personalized greeting, the monthly premium / amount due, and
 * CONTINUE / CANCEL buttons. Click CONTINUE to mount the OneInc PortalOne modal.
 *
 * OneInc's own confirmationDisplay notice is intentionally disabled in
 * public/oneinc-frame.html so the flow goes:
 *   ConfirmPaymentModal (Pay Now) -> OneInc card-entry directly (no notice).
 *
 * This component takes no responsibility for OneInc state; it's a pure
 * presentational gate. The launcher owns "have we initialized OneInc yet?".
 */
export function ConfirmPaymentModal({
  customerFirstName,
  customerFullName,
  amount,
  onContinue,
  onCancel,
  disabled = false,
  title = "MAKE A PAYMENT",
}: ConfirmPaymentModalProps) {
  const greetingName = (customerFullName || customerFirstName || "").trim()
  const formattedAmount = React.useMemo(() => {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return ""
    return `$${n.toFixed(2)}`
  }, [amount])

  if (typeof document === "undefined") return null

  return createPortal(
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.55)",
          zIndex: 9000,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="petrx-confirm-payment-title"
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9001,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            pointerEvents: "auto",
            background: "#ffffff",
            borderRadius: "12px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
            padding: "32px 36px 28px 36px",
            width: "min(560px, 100%)",
            color: "#0f172a",
            fontFamily:
              "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "20px",
            }}
          >
            <h2
              id="petrx-confirm-payment-title"
              style={{
                margin: 0,
                fontSize: "16px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                color: "#0f172a",
              }}
            >
              {title}
            </h2>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                aria-label="Close payment summary"
                style={{
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "13px",
                  letterSpacing: "0.04em",
                  color: "#64748b",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: 0,
                }}
              >
                CLOSE
                <span
                  aria-hidden
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: "20px",
                    height: "20px",
                    borderRadius: "50%",
                    background: "#0f172a",
                    color: "#fff",
                    fontSize: "12px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </span>
              </button>
            )}
          </div>

          <p
            style={{
              margin: "0 0 24px 0",
              fontSize: "15px",
              lineHeight: 1.5,
              color: "#1f2937",
            }}
          >
            {greetingName ? (
              <>
                <strong>{greetingName}</strong>, welcome to your Healthy Paws
                payment center. You can add a payment method on the next
                screen.
              </>
            ) : (
              <>
                Welcome to your Healthy Paws payment center. You can add a
                payment method on the next screen.
              </>
            )}
          </p>

          <div
            style={{
              marginBottom: "28px",
            }}
          >
            <div
              style={{
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.05em",
                color: "#0f172a",
                marginBottom: "8px",
              }}
            >
              MONTHLY PREMIUM
            </div>
            <div
              style={{
                fontSize: "13px",
                letterSpacing: "0.04em",
                color: "#475569",
                marginBottom: "4px",
                paddingLeft: "8px",
              }}
            >
              CURRENT AMOUNT DUE:
            </div>
            <div
              style={{
                fontSize: "38px",
                fontWeight: 400,
                color: "#0b7a2a",
                lineHeight: 1.1,
                paddingLeft: "8px",
              }}
            >
              {formattedAmount || "—"}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
              marginBottom: "20px",
            }}
          >
            <button
              type="button"
              onClick={onContinue}
              disabled={disabled || !formattedAmount}
              className="btn btn--primary"
              style={{
                width: "100%",
                maxWidth: "320px",
                padding: "14px 24px",
                fontSize: "15px",
                letterSpacing: "0.06em",
                borderRadius: "999px",
                fontWeight: 600,
              }}
            >
              CONTINUE
            </button>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={disabled}
                style={{
                  width: "100%",
                  maxWidth: "200px",
                  padding: "12px 24px",
                  fontSize: "14px",
                  letterSpacing: "0.06em",
                  borderRadius: "999px",
                  fontWeight: 600,
                  background: "#ffffff",
                  color: "#0b7a2a",
                  border: "1.5px solid #0b7a2a",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                CANCEL
              </button>
            )}
          </div>

          <p
            style={{
              margin: 0,
              fontSize: "13px",
              color: "#475569",
              lineHeight: 1.5,
            }}
          >
            <strong>NOTE:</strong> You&rsquo;ll finish enrolling at Healthy
            Paws when the payment transaction is complete.
          </p>
        </div>
      </div>
    </>,
    document.body,
  )
}
