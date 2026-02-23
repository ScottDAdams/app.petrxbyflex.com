import { useState, FormEvent } from "react"
import { API_BASE } from "../../../api"
import LoadingSpinner from "./LoadingSpinner"

const cleanApiBase = (API_BASE || "").replace(/\/+$/, "")
const RESEND_URL = `${cleanApiBase}/api/cards/resend`
const SUCCESS_MESSAGE = "If that email is in our system, we just sent you a link to your card."
const PET_IMAGE_SRC = "/images/petRxbyFlex_dog_blank.png"
const REQUEST_TIMEOUT_MS = 15000

interface ResendCardModalProps {
  onClose: () => void
}

const modalOverlay = {
  position: "fixed" as const,
  inset: 0,
  backgroundColor: "rgba(16, 24, 40, 0.5)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
}

const modalPanel = {
  background: "#fff",
  borderRadius: 12,
  maxWidth: 420,
  width: "100%",
  boxShadow: "0 20px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.08)",
  overflow: "hidden",
}

const modalHeader = {
  background: "linear-gradient(135deg, var(--color-brand, #2c5aa0) 0%, #1e3d6e 100%)",
  color: "#fff",
  padding: "20px 24px",
  textAlign: "center" as const,
}

const modalBody = {
  padding: "24px",
}

const petImageStyle = {
  height: 200,
  width: "auto",
  maxWidth: "100%",
  objectFit: "contain" as const,
  display: "block",
  margin: "0 auto 20px",
}

export function ResendCardModal({ onClose }: ResendCardModalProps) {
  const [email, setEmail] = useState("")
  const [submitted, setSubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return
    setIsSubmitting(true)
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      await fetch(RESEND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      setSubmitted(true)
    } catch {
      clearTimeout(timeoutId)
      setSubmitted(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="resend-card-title"
      style={modalOverlay}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <div style={modalHeader}>
          <h2 id="resend-card-title" style={{ margin: 0, fontSize: "1.2rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
            Email me my PetRx card
          </h2>
        </div>
        <div style={modalBody}>
          <img
            src={PET_IMAGE_SRC}
            alt=""
            style={petImageStyle}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none"
            }}
          />
          {!submitted ? (
            <form onSubmit={handleSubmit}>
              <label htmlFor="resend-email" style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, marginBottom: 8, color: "#374151" }}>
                Email address
              </label>
              <input
                id="resend-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                disabled={isSubmitting}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "1rem",
                  border: "1px solid var(--petrx-border, #e5e7eb)",
                  borderRadius: 8,
                  marginBottom: 20,
                  boxSizing: "border-box",
                  outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    padding: "10px 18px",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    border: "1px solid #d1d5db",
                    borderRadius: 8,
                    background: "#fff",
                    color: "#374151",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    padding: "10px 18px",
                    fontSize: "0.875rem",
                    fontWeight: 500,
                    border: "none",
                    borderRadius: 8,
                    background: "var(--color-brand, #2c5aa0)",
                    color: "#fff",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmitting ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      <LoadingSpinner />
                      Sending…
                    </span>
                  ) : (
                    "Send link"
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div style={{ textAlign: "center" }}>
              <p style={{ margin: "0 0 12px 0", fontSize: "1rem", lineHeight: 1.5, color: "#374151" }}>
                {SUCCESS_MESSAGE}
              </p>
              <p style={{ margin: "0 0 20px 0", fontSize: "0.875rem" }}>
                <a
                  href="https://petrxbyflex.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    color: "var(--color-brand, #2c5aa0)",
                    fontWeight: 500,
                    textDecoration: "none",
                  }}
                >
                  Get a free card →
                </a>
              </p>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "10px 24px",
                  fontSize: "0.875rem",
                  fontWeight: 500,
                  border: "none",
                  borderRadius: 8,
                  background: "var(--color-brand, #2c5aa0)",
                  color: "#fff",
                  cursor: "pointer",
                  width: "100%",
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
