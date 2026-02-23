/**
 * Loading overlay for enrollment flow. Personalized with pet avatar and steps.
 * Covers only #petrx-container (position: absolute); header stays visible.
 * Visibility is controlled by parent. Respects prefers-reduced-motion (no floating bg, halo, or shimmer).
 */
import * as React from "react"

export type FancyLoadingStage = "lead" | "card" | "quote"

type Props = {
  /** Show overlay (true while loading) */
  visible: boolean
  /** Optional: max ms to show overlay; after this we hide to prevent infinite wait */
  failsafeMs?: number
  /** Optional: owner first name (legacy) */
  ownerFirstName?: string
  /** Pet's name for headline e.g. "Setting up Luna's PetRx perks…" */
  petName?: string
  /** Pet's breed, shown under avatar */
  petBreed?: string
  /** URL to pet avatar image (no extra network request; use same as quote header) */
  petAvatarUrl?: string
  /** Which step is in progress: lead = step2, card = step3, quote = all done */
  stage?: FancyLoadingStage
}

const TIPS = [
  "Your digital savings card works at 80k+ pharmacies.",
  "Insurance is optional—use the card to save right away.",
  "Most pets save the most on chronic meds.",
  "You can add other pets later for multi-pet savings.",
]

type StepStatus = "done" | "in-progress" | "pending"

function Step({
  status,
  label,
  sub,
}: {
  status: StepStatus
  label: string
  sub?: string
}) {
  const done = status === "done"
  const inProgress = status === "in-progress"

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "24px 1fr",
        gap: 10,
        alignItems: "start",
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: done ? "#0a7a2d" : "transparent",
          border: "2px solid #0a7a2d",
          display: "grid",
          placeItems: "center",
          flexShrink: 0,
        }}
        aria-hidden
      >
        {done && (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
        {inProgress && (
          <span className="fancy-loading-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
        )}
      </div>
      <div>
        <div style={{ fontWeight: 700 }}>{label}</div>
        {sub && <div style={{ fontSize: 12, opacity: 0.7 }}>{sub}</div>}
      </div>
    </div>
  )
}

function PawPlaceholder() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        background: "linear-gradient(145deg, #e8f0ec 0%, #d4e4db 100%)",
        border: "2px solid rgba(10, 122, 45, 0.2)",
        display: "grid",
        placeItems: "center",
      }}
      aria-hidden
    >
      <svg
        width="40%"
        height="40%"
        viewBox="0 0 24 24"
        fill="#0a7a2d"
        style={{ opacity: 0.6 }}
      >
        <path d="M12 22c3-2.5 6-2.5 9 0-2-5-5-7-9-7s-7 2-9 7c3-2.5 6-2.5 9 0z" />
        <circle cx="5" cy="8" r="2.5" />
        <circle cx="10" cy="5" r="2.5" />
        <circle cx="14" cy="5" r="2.5" />
        <circle cx="19" cy="8" r="2.5" />
      </svg>
    </div>
  )
}

export function FancyLoadingOverlay({
  visible,
  failsafeMs = 60000,
  ownerFirstName: _ownerFirstName,
  petName,
  petBreed,
  petAvatarUrl,
  stage = "lead",
}: Props) {
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

  // Step status from stage
  const step1: StepStatus = "done"
  const step2: StepStatus = stage === "lead" ? "in-progress" : "done"
  const step3: StepStatus = stage === "quote" ? "done" : stage === "card" ? "in-progress" : "pending"

  const progress = stage === "quote" ? 1 : stage === "card" ? 2 / 3 : 1 / 3

  const headline = petName
    ? `Setting up ${petName}'s PetRx perks…`
    : "Setting up your PetRx perks…"

  return (
    <div
      aria-live="polite"
      role="progressbar"
      aria-valuetext={headline}
      className="fancy-loading-overlay"
      data-reduced-motion={prefersReducedMotion ? "true" : undefined}
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
      {/* Background: soft paw bubbles or blobs — only when motion allowed */}
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
          {Array.from({ length: 10 }).map((_, i) => {
            const size = 20 + (i % 4) * 6
            const left = (i * 11) % 100
            const dur = 12 + (i % 3) * 2
            return (
              <div
                key={i}
                className="fancy-bubble"
                style={{
                  position: "absolute",
                  left: left + "%",
                  bottom: -20,
                  width: size,
                  height: size,
                  opacity: 0.08,
                  animation: `fancy-rise ${dur}s linear ${i * 0.7}s infinite`,
                }}
              >
                <svg width={size} height={size} viewBox="0 0 24 24" fill="#2d5016">
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
        className="fancy-loading-card"
        style={{
          position: "relative",
          width: "min(720px, 92vw)",
          background: "#fff",
          border: "1px solid #eef0f2",
          boxShadow: "0 20px 60px rgba(0,0,0,.06)",
          borderRadius: 16,
          padding: 24,
          display: "grid",
          gap: 20,
          overflow: "hidden",
        }}
      >
        {/* Subtle diagonal shimmer on card — only when motion allowed */}
        {!prefersReducedMotion && (
          <div
            aria-hidden
            className="fancy-card-shimmer"
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background:
                "linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.4) 45%, transparent 55%)",
              backgroundSize: "200% 100%",
              animation: "fancy-shimmer 4s ease-in-out infinite",
            }}
          />
        )}

        <div style={{ display: "grid", gap: 8, position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0a7a2d" }}>
            Setting things up…
          </div>
          <h2
            style={{
              fontSize: "clamp(1.25rem, 4vw, 1.5rem)",
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.25,
            }}
          >
            {headline}
          </h2>
          <p style={{ fontSize: 14, opacity: 0.85, margin: 0 }}>
            We're creating your free savings card and loading your wellness options.
          </p>
          <div style={{ fontSize: 13, opacity: 0.7, minHeight: 18 }}>{TIPS[tipIndex]}</div>
        </div>

        {/* Hero avatar block */}
        <div
          style={{
            display: "grid",
            placeItems: "center",
            gap: 8,
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            className={!prefersReducedMotion ? "fancy-avatar-float" : undefined}
            style={{
              position: "relative",
              // 96–120px desktop, ~80px mobile
              width: "clamp(80px, 20vw, 120px)",
              height: "clamp(80px, 20vw, 120px)",
            }}
          >
            {!prefersReducedMotion && (
              <div
                className="fancy-avatar-halo"
                aria-hidden
                style={{
                  position: "absolute",
                  inset: -6,
                  borderRadius: "50%",
                  background: "conic-gradient(from 0deg, #0a7a2d30, #33B46E60, #0a7a2d30, #33B46E40)",
                }}
              />
            )}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "100%",
                borderRadius: "50%",
                overflow: "hidden",
                border: "3px solid #fff",
                boxShadow: "0 4px 20px rgba(0,0,0,.08)",
              }}
            >
              {petAvatarUrl ? (
                <img
                  src={petAvatarUrl}
                  alt=""
                  width={120}
                  height={120}
                  loading="eager"
                  decoding="async"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <PawPlaceholder />
              )}
            </div>
          </div>
          {petBreed && (
            <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{petBreed}</div>
          )}
        </div>

        <div
          style={{
            position: "relative",
            height: 8,
            background: "#f1f5f9",
            borderRadius: 999,
            overflow: "hidden",
            zIndex: 1,
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

        <div style={{ display: "grid", gap: 12, position: "relative", zIndex: 1 }}>
          <Step status={step1} label="Confirming details" sub="Owner & pet info received" />
          <Step
            status={step2}
            label="Issuing your digital savings card"
            sub="Generating card image"
          />
          <Step status={step3} label="Loading wellness options" sub="Fetching options for you" />
        </div>
      </div>

      <style>{`
        @keyframes fancy-rise {
          0% { transform: translateY(0) scale(.9); }
          70% { opacity: .08; }
          100% { transform: translateY(-115vh) scale(1.05); opacity: 0; }
        }
        @keyframes fancy-shimmer {
          0%, 100% { background-position: 200% 0; }
          50% { background-position: -100% 0; }
        }
        @keyframes fancy-halo-rotate {
          to { transform: rotate(360deg); }
        }
        @keyframes fancy-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }
        .fancy-avatar-float {
          animation: fancy-float 3s ease-in-out infinite;
        }
        .fancy-avatar-halo {
          animation: fancy-halo-rotate 6s linear infinite;
          -webkit-mask: radial-gradient(farthest-side, transparent 78%, #fff 78%);
          mask: radial-gradient(farthest-side, transparent 78%, #fff 78%);
        }
        .fancy-loading-dots {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 2px;
        }
        .fancy-loading-dots span {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: #0a7a2d;
          animation: fancy-dots 1s ease-in-out infinite both;
        }
        .fancy-loading-dots span:nth-child(2) { animation-delay: .15s; }
        .fancy-loading-dots span:nth-child(3) { animation-delay: .3s; }
        @keyframes fancy-dots {
          0%, 80%, 100% { transform: scale(0.6); opacity: .5; }
          40% { transform: scale(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .fancy-avatar-float,
          .fancy-avatar-halo,
          .fancy-card-shimmer,
          .fancy-bubble { animation: none !important; }
        }
      `}</style>
    </div>
  )
}
