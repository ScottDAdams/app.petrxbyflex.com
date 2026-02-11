import * as React from "react"

export type CardGuidedOverlayProps = {
  /** Ref to the card container (card-panel or card-first-hero) to highlight */
  cardPanelRef: React.RefObject<HTMLElement | null>
  onDismiss: (reason: "click" | "esc" | "timeout") => void
}

const FADE_OUT_MS = 250

export function CardGuidedOverlay({ cardPanelRef, onDismiss }: CardGuidedOverlayProps) {
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  const [isExiting, setIsExiting] = React.useState(false)
  const dismissedRef = React.useRef(false)
  const onDismissRef = React.useRef(onDismiss)
  onDismissRef.current = onDismiss

  const dismiss = React.useCallback((reason: "click" | "esc" | "timeout") => {
    if (dismissedRef.current) return
    dismissedRef.current = true
    setIsExiting(true)
    setTimeout(() => {
      onDismissRef.current(reason)
    }, FADE_OUT_MS)
  }, [])

  React.useEffect(() => {
    const updateRect = () => {
      if (cardPanelRef.current) {
        setRect(cardPanelRef.current.getBoundingClientRect())
      } else {
        setRect(null)
      }
    }
    updateRect()
    const ro = new ResizeObserver(updateRect)
    if (cardPanelRef.current) {
      ro.observe(cardPanelRef.current)
    }
    window.addEventListener("scroll", updateRect, true)
    window.addEventListener("resize", updateRect)
    return () => {
      ro.disconnect()
      window.removeEventListener("scroll", updateRect, true)
      window.removeEventListener("resize", updateRect)
    }
  }, [cardPanelRef])

  React.useEffect(() => {
    const t = setTimeout(() => dismiss("timeout"), 5000)
    return () => clearTimeout(t)
  }, [dismiss])

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss("esc")
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [dismiss])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    dismiss("click")
  }

  const clipPath =
    rect != null
      ? `polygon(evenodd, 0px 0px, 100vw 0px, 100vw 100vh, 0px 100vh, 0px 0px, ${rect.left}px ${rect.top}px, ${rect.left + rect.width}px ${rect.top}px, ${rect.left + rect.width}px ${rect.top + rect.height}px, ${rect.left}px ${rect.top + rect.height}px, ${rect.left}px ${rect.top}px)`
      : undefined

  return (
    <div
      className={`card-guided-overlay${isExiting ? " card-guided-overlay--exiting" : ""}`}
      role="dialog"
      aria-label="Add your card to your wallet"
      aria-modal="true"
      style={{ pointerEvents: "none" }}
    >
      <div
        className="card-guided-overlay__backdrop"
        style={clipPath ? { clipPath } : undefined}
        onClick={handleBackdropClick}
        aria-hidden
      />
      {rect && (
        <>
          <div
            className="card-guided-overlay__highlight"
            style={{
              position: "fixed",
              left: rect.left - 8,
              top: rect.top - 8,
              width: rect.width + 16,
              height: rect.height + 16,
            }}
          />
          <div
            className="card-guided-overlay__speech"
            style={{
              position: "fixed",
              left: rect.left,
              top: rect.bottom + 12,
            }}
          >
            <p className="card-guided-overlay__speech-text">
              Add your card to your digital wallet for quick access at the pharmacy.
            </p>
            <div className="card-guided-overlay__speech-arrow" />
          </div>
        </>
      )}
    </div>
  )
}
