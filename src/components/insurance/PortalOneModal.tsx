import * as React from "react"

const PORTALONE_SCRIPT_CACHE: Record<string, Promise<void>> = {}
const _initializedSessions = new Set<string>()

function isMobileDevice(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches
}

/**
 * Load a script by src once; cache by src so route transitions don't double-load.
 */
function loadScriptOnce(src: string): Promise<void> {
  if (src in PORTALONE_SCRIPT_CACHE) {
    return PORTALONE_SCRIPT_CACHE[src]
  }
  const p = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
      resolve()
      return
    }
    const script = document.createElement("script")
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })
  PORTALONE_SCRIPT_CACHE[src] = p
  return p
}

const JQUERY_CDN = "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"

function ensureJQuery(): Promise<void> {
  if ((window as Window & { jQuery?: unknown }).jQuery) {
    return Promise.resolve()
  }
  return loadScriptOnce(JQUERY_CDN)
}

function getPortalOneScriptUrl(): string {
  const fromEnv = (import.meta.env.VITE_ONEINC_PORTALONE_JS_URL as string)?.trim()
  if (fromEnv) return fromEnv
  const env = (import.meta.env.VITE_ONEINC_ENV as string)?.toLowerCase() || "staging"
  if (env === "prod" || env === "production") {
    return "https://portalone.processonepayments.com/GenericModal/Cdn/PortalOne.js"
  }
  return "https://stgportalone.processonepayments.com/GenericModal/Cdn/PortalOne.js"
}

export type PortalOneModalProps = {
  sessionId: string
  amount: number
  leadId: string
  memberId: string
  onInitError?: (err: Error) => void
  onPaymentComplete?: (data: {
    paymentToken: string
    transactionId: string
    paymentMethod: "CreditCard" | "ECheck"
    convenienceFee?: number
    billingFirstName?: string
    billingLastName?: string
    billingStreet?: string
    billingCity?: string
    billingState?: string
    billingPostalCode?: string
  }) => void
}

/**
 * Renders the PortalOne container and initializes the modal with sessionId after the script loads.
 * Script URL: VITE_ONEINC_PORTALONE_JS_URL or derived from VITE_ONEINC_ENV (staging|prod).
 * Init: jQuery $.fn.portalOne if present, else window.portalOne / window.PortalOne.
 */
export function PortalOneModal({ sessionId, amount, leadId, memberId: _memberId, onInitError, onPaymentComplete }: PortalOneModalProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const initLoggedRef = React.useRef(false)
  const iframeObserverRef = React.useRef<MutationObserver | null>(null)

  React.useEffect(() => {
    if (!sessionId) return
    if (_initializedSessions.has(sessionId)) return
    _initializedSessions.add(sessionId)

    const scriptUrl = getPortalOneScriptUrl()
    ensureJQuery()
      .then(() => loadScriptOnce(scriptUrl))
      .then(() => {
        const win = window as Window & {
          jQuery?: { fn?: { portalOne?: (opts: { sessionId: string }) => void }; (el: HTMLElement | null): unknown }
          portalOne?: { init: (opts: { sessionId: string }) => void }
          PortalOne?: { init: (opts: { sessionId: string }) => void }
        }
        const hasJQ = !!win.jQuery
        const hasPlugin = !!(win.jQuery?.fn?.portalOne)
        const keys = Object.keys(win).filter((k) => k.toLowerCase().includes("portal"))
        if (!initLoggedRef.current) {
          console.info("[PortalOne] script loaded", {
            hasJQ,
            hasPlugin,
            keys,
          })
          initLoggedRef.current = true
        }
        console.info("[PortalOne] init", { sessionId })

        const container = containerRef.current
        if (!container) {
          const err = new Error("[PortalOne] container ref not mounted")
          console.error("[PortalOne] init failed", err)
          onInitError?.(err)
          return
        }

        if (hasJQ && hasPlugin && win.jQuery) {
          try {
            const $container = win.jQuery(container) as {
              portalOne: () => void
              data: (key: string) => unknown
            }
            // Step 1: initialize (stores instance in jQuery data)
            $container.portalOne()
            // Move PortalOne's iframe into our container on desktop; on mobile leave on body as native fullscreen modal
            const observer = new MutationObserver((mutations) => {
              for (const mutation of mutations) {
                for (const node of Array.from(mutation.addedNodes)) {
                  if (node instanceof HTMLIFrameElement && node.src?.includes("processonepayments.com")) {
                    if (!isMobileDevice()) {
                      container.appendChild(node)
                    }
                    // On mobile: leave iframe on body as native fullscreen modal
                    observer.disconnect()
                  }
                }
              }
            })
            observer.observe(document.body, { childList: true, subtree: true })
            iframeObserverRef.current = observer
            ;(win.jQuery(container) as { on: (event: string, handler: (evt: unknown, data: Record<string, unknown>) => void) => void }).on("portalOne.paymentComplete", function(_evt: unknown, data: Record<string, unknown>) {
              console.info("[PortalOne] portalOne.paymentComplete", data)
              if (typeof data?.acknowledge === "function") (data.acknowledge as () => void)()
              onPaymentComplete?.({
                paymentToken: data.paymentToken as string,
                transactionId: data.transactionId as string,
                paymentMethod: data.paymentCategory === "ECheck" ? "ECheck" : "CreditCard",
                convenienceFee: data.convenienceFee != null ? Number(data.convenienceFee) : undefined,
                billingFirstName: data.billingFirstName as string,
                billingLastName: data.billingLastName as string,
                billingStreet: data.billingAddress as string,
                billingCity: data.billingCity as string,
                billingState: data.billingState as string,
                billingPostalCode: data.billingZip as string,
              })
            })
            ;(win.jQuery(container) as { on: (event: string, handler: () => void) => void }).on("portalOne.unload", () => {
              console.info("[PortalOne] portalOne.unload")
            })
            // Step 2: get the instance and call makePayment on it
            const instance = $container.data("portalOne") as {
              makePayment: (opts: Record<string, unknown>) => void
            } | undefined
            if (!instance) throw new Error("[PortalOne] instance not found after init")
            const returnUrl = `${import.meta.env.VITE_API_BASE || "https://api.petrxbyflex.com"}/api/oneinc/return`
            console.info("[PortalOne] calling makePayment", {
              sessionId,
              amount,
              leadId,
              paymentCategory: "UserSelect",
              saveOption: "Save",
              acknowledgmentRequired: "true",
              returnUrl,
            })
            instance.makePayment({
              sessionId,
              paymentCategory: "UserSelect",
              feeContext: 0,
              minAmountDue: amount,
              clientReferenceData1: leadId,
              saveOption: "Save",
              acknowledgmentRequired: "true",
              returnUrl,
            })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        if (win.portalOne?.init) {
          try {
            win.portalOne.init({ sessionId })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        if (win.PortalOne?.init) {
          try {
            win.PortalOne.init({ sessionId })
          } catch (e) {
            const err = e instanceof Error ? e : new Error(String(e))
            console.error("[PortalOne] init failed", err)
            onInitError?.(err)
          }
          return
        }

        const err = new Error(
          "[PortalOne] No API found: expected window.jQuery.fn.portalOne or window.portalOne or window.PortalOne"
        )
        console.error("[PortalOne] init failed", err)
        onInitError?.(err)
      })
      .catch((err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        console.error("[PortalOne] init failed", e)
        onInitError?.(e)
      })

    return () => {
      _initializedSessions.delete(sessionId)
      iframeObserverRef.current?.disconnect()
      iframeObserverRef.current = null
    }
  }, [sessionId, amount, leadId, onInitError, onPaymentComplete])

  return (
    <div
      id="portalOneContainer"
      ref={containerRef}
      className="portal-one-container"
      style={
        isMobileDevice()
          ? {}
          : {
              position: "relative",
              width: "100%",
              height: "950px",
              overflow: "hidden",
              transform: "translateZ(0)",
            }
      }
    />
  )
}
