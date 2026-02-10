import * as React from "react"

export type PrimaryActionButtonProps = {
  /** Action to trigger when button is activated */
  onAction: () => void
  /** Whether the button is disabled */
  disabled?: boolean
  /** Button content */
  children: React.ReactNode
  /** Additional CSS classes */
  className?: string
  /** Additional button props */
  [key: string]: any
}

/**
 * PrimaryActionButton - Triggers action on pointer down (before blur) to prevent
 * first-click-does-nothing issues caused by blur/onBlur validation + state updates.
 * 
 * Uses onPointerDown to fire the action before blur events can interfere.
 * Includes a double-fire guard to prevent both pointerdown and click from firing.
 */
export function PrimaryActionButton({
  onAction,
  disabled = false,
  children,
  className = "",
  ...buttonProps
}: PrimaryActionButtonProps) {
  const actionFiredRef = React.useRef(false)
  const resetTimeoutRef = React.useRef<number | null>(null)

  // Cleanup timeout on unmount
  React.useEffect(() => {
    return () => {
      if (resetTimeoutRef.current !== null) {
        clearTimeout(resetTimeoutRef.current)
      }
    }
  }, [])

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled) {
        return
      }

      // Prevent default to avoid focus/blur issues
      e.preventDefault()
      e.stopPropagation()

      // Guard against double-firing
      if (actionFiredRef.current) {
        return
      }

      // Mark as fired
      actionFiredRef.current = true

      // Clear any existing reset timeout
      if (resetTimeoutRef.current !== null) {
        clearTimeout(resetTimeoutRef.current)
      }

      // Reset guard after a short delay (allows click event to be ignored)
      // 100ms is enough for click to fire but short enough to reset quickly
      resetTimeoutRef.current = window.setTimeout(() => {
        actionFiredRef.current = false
        resetTimeoutRef.current = null
      }, 100)

      // Trigger the action
      onAction()
    },
    [disabled, onAction]
  )

  const handleClick = React.useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      // If action already fired from pointerdown, ignore click
      if (actionFiredRef.current) {
        e.preventDefault()
        e.stopPropagation()
        return
      }

      // Fallback: if pointer events didn't fire (e.g., keyboard navigation), allow click
      if (!disabled) {
        actionFiredRef.current = true

        // Clear any existing reset timeout
        if (resetTimeoutRef.current !== null) {
          clearTimeout(resetTimeoutRef.current)
        }

        // Reset guard after a short delay
        resetTimeoutRef.current = window.setTimeout(() => {
          actionFiredRef.current = false
          resetTimeoutRef.current = null
        }, 100)

        onAction()
      }
    },
    [disabled, onAction]
  )

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      {...buttonProps}
    >
      {children}
    </button>
  )
}
