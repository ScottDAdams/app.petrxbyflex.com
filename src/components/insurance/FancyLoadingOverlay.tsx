/**
 * Loading overlay for enrollment flow. Styled like the old site FancyLoadingOverlay.
 * Covers only #petrx-container (position: absolute); header stays visible.
 * Visibility is controlled by parent (leadLoading). Dismiss only when /lead returns.
 */
import * as React from "react"

type Props = {
  /** Show overlay (true while lead request in flight) */
  visible: boolean
  /** Optional: max ms to show overlay; after this we hide to prevent infinite wait */
  failsafeMs?: number
  /** Optional: owner first name for "Hang tight, {name}!" */
  ownerFirstName?: string
}

const TIPS = [
  "Your digital savings card works at 80k+ pharmacies.",
  "Insurance is optional—use the card to save right away.",
  "Most pets save the most on chronic meds.",
  "You can add other pets later for multi-pet savings.",
]

function Step({ done, label, sub }: { done: boolean; label: string; sub?: string }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr",
        gap: 10,
        alignItems: "start",
      }}
    >
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 999,
          background: done ? "#0a7a2d" : "transparent",
          border: "2px solid #0a7a2d",
          display: "grid",
          placeItems: "center",
          transform: done ? "scale(1)" : "scale(.95)",
          transition: "all .25s ease",
        }}
        aria-hidden
      >
        {done && (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, opacity: 0.7 }}>{sub}</div>}
      </div>
    </div>
  )
}

export function FancyLoadingOverlay({ visible, failsafeMs = 60000, ownerFirstName }: Props) {
  const [failsafeFired, setFailsafeFired] = React.useState(false)
  const [tipIndex, setTipIndex] = React.useState(0)
  const effectiveVisible = visible && !failsafeFired

  const prefersReducedMotion = React.useMemo(() => {
    if (typeof window === "undefined" || !("matchMedia" in window)) return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  }, [])

  React.useEffect(() => {
    if (!visible) {
      setFailsafeFired(false)
      return
    }
    setFailsafeFired(false)
    const t = window.setTimeout(() => setFailsafeFired(true), failsafeMs)
    return () => window.clearTimeout(t)
  }, [visible, failsafeMs])

  React.useEffect(() => {
    if (!effectiveVisible || prefersReducedMotion) return
    const id = window.setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 2200)
    return () => window.clearInterval(id)
  }, [effectiveVisible, prefersReducedMotion])

  if (!effectiveVisible) return null

  // While visible: step 1 done, steps 2 & 3 in progress (we don't get card/plans events; lead covers "quote")
  const progress = 1 / 3

  return (
    <div
      aria-live="polite"
      role="progressbar"
      aria-valuetext={`Getting everything ready${ownerFirstName ? ` for ${ownerFirstName}` : ""}`}
      className="fancy-loading-overlay"
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 10,
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(1200px 600px at 20% -10%, #E9F7EF 0%, #ffffff 60%)",
        pointerEvents: "auto",
      }}
    >
      {!prefersReducedMotion && (
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            overflow: "hidden",
            pointerEvents: "none",
          }}
        >
          {Array.from({ length: 12 }).map((_, i) => {
            const size = 18 + (i % 5) * 4
            const left = (i * 9) % 100
            const dur = 9 + (i % 4) * 2
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: left + "%",
                  bottom: -30,
                  opacity: 0.12,
                  animation: `fancy-rise ${dur}s linear ${i * 0.6}s infinite`,
                }}
              >
                <svg width={size} height={size} viewBox="0 0 24 24" fill="#7B3F00">
                  <path d="M12 22c3-2.5 6-2.5 9 0-2-5-5-7-9-7s-7 2-9 7c3-2.5 6-2.5 9 0z" />
                  <circle cx="5" cy="8" r="2.5" />
                  <circle cx="10" cy="5" r="2.5" />
                  <circle cx="14" cy="5" r="2.5" />
                  <circle cx="19" cy="8" r="2.5" />
                </svg>
              </div>
            )
          })}
        </div>
      )}

      <div
        style={{
          width: "min(720px, 92vw)",
          background: "#fff",
          border: "1px solid #eef0f2",
          boxShadow: "0 20px 60px rgba(0,0,0,.06)",
          borderRadius: 16,
          padding: 24,
          display: "grid",
          gap: 16,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0a7a2d" }}>
            Getting everything ready…
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>
            {ownerFirstName ? `Hang tight, ${ownerFirstName}!` : "Hang tight!"} We're creating your
            savings card and checking ways to save.
          </div>
          <div style={{ fontSize: 13, opacity: 0.7, minHeight: 18 }}>{TIPS[tipIndex]}</div>
        </div>

        <div
          style={{
            position: "relative",
            height: 8,
            background: "#f1f5f9",
            borderRadius: 999,
            overflow: "hidden",
            marginTop: 4,
          }}
          aria-label="Progress"
        >
          <div
            style={{
              position: "absolute",
              inset: "0 0 0 0",
              transformOrigin: "left",
              transform: `scaleX(${progress})`,
              background: "linear-gradient(90deg, #33B46E, #0a7a2d)",
              transition: "transform .35s ease",
            }}
          />
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <Step done label="Confirming details" sub="Owner & pet info received" />
          <Step done={false} label="Issuing your digital savings card" sub="Generating card image" />
          <Step done={false} label="Checking other options" sub="Fetching other options" />
        </div>
      </div>

      <style>{`
        @keyframes fancy-rise {
          0% { transform: translateY(0) scale(.9); }
          70% { opacity: .12; }
          100% { transform: translateY(-115vh) scale(1.05); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
