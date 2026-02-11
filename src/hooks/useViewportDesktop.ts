import * as React from "react"

const BREAKPOINT = 768

/**
 * Returns true when viewport width is >= 768px (desktop). Used to avoid rendering
 * desktop-only UI (e.g. guided overlay) on mobile at all.
 */
export function useViewportDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(false)

  React.useEffect(() => {
    const check = () => setIsDesktop(typeof window !== "undefined" && window.innerWidth >= BREAKPOINT)
    check()
    const mql = window.matchMedia(`(min-width: ${BREAKPOINT}px)`)
    const listener = () => check()
    mql.addEventListener("change", listener)
    return () => mql.removeEventListener("change", listener)
  }, [])

  return isDesktop
}
