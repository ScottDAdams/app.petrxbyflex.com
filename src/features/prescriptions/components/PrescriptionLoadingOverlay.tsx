/**
 * Loading overlay for Rx price lookup. Themed for prescription savings:
 * rotating tips, Rx/pill icon, brand green. Respects prefers-reduced-motion.
 */
import { useState, useEffect, useMemo } from "react"
import "./prescriptions.css"

const RX_TIPS = [
  "Comparing prices at 80,000+ pharmacies nationwide.",
  "You can use your PetRx savings card with or without insurance.",
  "Generic options often save the most—we'll show you both.",
  "Prices update in real time so you see current discounts.",
  "Switch form, strength, or quantity above to compare options.",
]

type Props = {
  /** Optional: "pet" shows friendlier copy, "rx" more neutral */
  source?: "pet" | "rx"
}

export function PrescriptionLoadingOverlay({ source = "pet" }: Props) {
  const [tipIndex, setTipIndex] = useState(0)

  const prefersReducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }, [])

  useEffect(() => {
    if (prefersReducedMotion) return
    const id = window.setInterval(() => setTipIndex((i) => (i + 1) % RX_TIPS.length), 2600)
    return () => window.clearInterval(id)
  }, [prefersReducedMotion])

  const headline =
    source === "rx"
      ? "Finding the best prescription prices…"
      : "Sniffing out the best prices…"
  const subline =
    source === "rx"
      ? "Checking pharmacies near you for savings."
      : "Checking pharmacies near you for your furry friend."

  return (
    <div
      aria-live="polite"
      role="progressbar"
      aria-valuetext={headline}
      className="prescription-loading-overlay"
      data-reduced-motion={prefersReducedMotion ? "true" : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "radial-gradient(1200px 600px at 50% 0%, #E9F7EF 0%, #ffffff 55%)",
        backdropFilter: "blur(4px)",
      }}
    >
      {!prefersReducedMotion && (
        <div aria-hidden className="prescription-loading-bubbles">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="prescription-loading-bubble"
              style={{
                "--bubble-size": `${18 + (i % 3) * 6}px`,
                "--bubble-left": `${(i * 13) % 100}%`,
                "--bubble-dur": `${14 + (i % 2) * 2}s`,
                "--bubble-delay": `${i * 0.6}s`,
              } as React.CSSProperties}
            >
              <svg viewBox="0 0 24 24" fill="#0a7a2d" style={{ opacity: 0.12 }}>
                <path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H5V6h14v12z" />
                <ellipse cx="12" cy="12" rx="3" ry="5" fill="#0a7a2d" />
              </svg>
            </div>
          ))}
        </div>
      )}

      <div
        className="prescription-loading-card"
        style={{
          position: "relative",
          width: "min(520px, 90vw)",
          background: "#fff",
          border: "1px solid #e8f0ec",
          boxShadow: "0 20px 50px rgba(10, 122, 45, 0.08)",
          borderRadius: 16,
          padding: 28,
          overflow: "hidden",
        }}
      >
        {!prefersReducedMotion && (
          <div
            aria-hidden
            className="prescription-loading-shimmer"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.5) 45%, transparent 55%)",
              backgroundSize: "200% 100%",
            }}
          />
        )}

        <div style={{ position: "relative", zIndex: 1, display: "grid", gap: 12, textAlign: "center" }}>
          <div
            className={!prefersReducedMotion ? "prescription-loading-icon-wrap" : undefined}
            style={{
              display: "grid",
              placeItems: "center",
              margin: "0 auto 8px",
              width: 72,
              height: 72,
              borderRadius: "50%",
              background: "linear-gradient(145deg, #E9F7EF 0%, #d4e4db 100%)",
              border: "2px solid rgba(10, 122, 45, 0.2)",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0a7a2d" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2z" />
              <ellipse cx="12" cy="12" rx="3" ry="5" />
              <path d="M12 7v2M12 15v2" />
            </svg>
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#0a7a2d" }}>
            Finding savings…
          </div>
          <h2 style={{ fontSize: "clamp(1.2rem, 3vw, 1.4rem)", fontWeight: 800, margin: 0, lineHeight: 1.3 }}>
            {headline}
          </h2>
          <p style={{ fontSize: 14, color: "#4b5563", margin: 0 }}>
            {subline}
          </p>
          <div
            style={{
              minHeight: 20,
              fontSize: 13,
              color: "#6b7280",
              marginTop: 4,
            }}
          >
            {RX_TIPS[tipIndex]}
          </div>
          <div className="prescription-loading-dots" aria-hidden style={{ marginTop: 8 }}>
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </div>
  )
}
