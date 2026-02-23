/**
 * Layout with conditional header driven by session.funnel_type + current_step.
 *
 * FRAMER SEAM: This app is entered only via /start?session_id=... from Framer.
 * When mock mode is enabled, session comes from mocks; banner is shown.
 */
import { Outlet } from "react-router-dom"
import { useSessionOptional } from "../context/SessionContext"
import { useLeadLoading } from "../context/LeadLoadingContext"
import { AppHeader } from "../components/AppHeader"
import { MockBanner } from "../components/MockBanner"
import { FancyLoadingOverlay } from "../components/insurance/FancyLoadingOverlay"

export function AppLayout() {
  const sessionContext = useSessionOptional()
  const { leadLoading } = useLeadLoading()

  const isQuoteSteps = (): boolean => {
    if (!sessionContext || sessionContext.state.status !== "ready") return true
    const { session } = sessionContext.state
    const step = (session.current_step ?? "").toLowerCase()
    const funnel = (session.funnel_type ?? "").toLowerCase()
    if (funnel === "card_only" || funnel === "card_only_flow") return true
    // Hide Med Lookup during quote flow steps
    if (step === "quote" || step === "details" || step === "payment" || step === "confirm" || step === "plan_select") return true
    return false
  }

  const showFullHeader =
    sessionContext?.state.status === "ready" && !isQuoteSteps()

    const session =
    sessionContext?.state.status === "ready"
      ? (sessionContext.state as any).session
      : undefined

  const ownerFirstName: string | undefined = session?.owner?.first_name

  // --- pet fields (best-effort; supports multiple session shapes) ---
  const petName: string | undefined =
    session?.pet?.name ?? session?.pet_name ?? session?.petName

  const petBreedLabel: string | undefined =
    session?.pet?.breed_label ??
    session?.pet?.breed_name ??
    session?.pet_breed_name ??
    session?.petBreedName

  const petBreedId: number | string | undefined =
    session?.pet?.breed_id ?? session?.pet_breed ?? session?.petBreed

  const petTypeRaw: string | undefined =
    session?.pet?.type ?? session?.pet_type ?? session?.petType

  const petAvatarUrl = (() => {
    if (!petTypeRaw || petBreedId == null) return undefined
    const id =
      typeof petBreedId === "string" ? parseInt(petBreedId, 10) : petBreedId
    if (!id || Number.isNaN(id)) return undefined

    const t = petTypeRaw.toLowerCase()
    const folder = t === "dog" || t === "dogs" ? "dogs" : t === "cat" || t === "cats" ? "cats" : undefined
    if (!folder) return undefined

    // use relative path so it works in all envs
    return `/assets/breed-avatars/${folder}/${id}.png`
  })()

  const stage = (() => {
    const step = String(session?.current_step ?? "").toLowerCase()
    // Map your steps to loader stage (best guess)
    if (step === "quote") return "quote" as const
    if (step === "payment" || step === "confirm") return "card" as const
    return "lead" as const
  })()


  return (
    <div className="app-layout">
      <AppHeader fullNav={showFullHeader} />
      <main className="app-main">
        <div id="petrx-container" className="petrx-container" style={{ position: "relative" }}>
        {leadLoading && (
            <FancyLoadingOverlay
              visible={leadLoading}
              ownerFirstName={ownerFirstName}
              petName={petName}
              petBreed={petBreedLabel}
              petAvatarUrl={petAvatarUrl}
              stage={stage}
            />
          )}

          <MockBanner />
          <Outlet />
        </div>
      </main>
    </div>
  )
}
