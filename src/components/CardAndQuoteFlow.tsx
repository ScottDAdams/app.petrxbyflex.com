import * as React from "react"
import { useSession } from "../context/SessionContext"
import { updateSessionStep } from "../api/session"
import { CardDisplayPanel } from "./CardDisplayPanel"
import { InsuranceProgress } from "./InsuranceProgress"
import { InsuranceQuoteSelector } from "./InsuranceQuoteSelector"
import { FLOW_STEPS } from "./flowSteps"
import type { ProcessedPlans } from "./InsuranceQuoteSelector"
import type { SessionData } from "../api/session"

function processInsuranceProducts(products: unknown[]): ProcessedPlans {
  if (!Array.isArray(products) || products.length === 0) {
    return {
      allReimbursements: [],
      allDeductibles: [],
      defaultPolicy: null,
      allPolicies: [],
    }
  }
  const allPolicies = products as Record<string, unknown>[]
  const allReimbursements = [
    ...new Set(
      allPolicies.map((p) =>
        Math.round(((p.reimbursement as number) || 0) * 100).toString()
      )
    ),
  ].sort()
  const allDeductibles = [
    ...new Set(allPolicies.map((p) => String(p.deductible ?? "0"))),
  ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  const defaultPolicy =
    allPolicies.find((p) => p.reimbursement === 0.7 && p.deductible === 500) ||
    allPolicies[0] ||
    null
  return {
    allReimbursements,
    allDeductibles,
    defaultPolicy,
    allPolicies,
  }
}

function getCurrentStepId(session: SessionData): string {
  const step = (session.current_step ?? "quote").toLowerCase()
  const match = FLOW_STEPS.find((s) => s.id === step)
  return match?.id ?? "quote"
}

function getCompletedStepIds(session: SessionData): string[] {
  const current = getCurrentStepId(session)
  const idx = FLOW_STEPS.findIndex((s) => s.id === current)
  const maxIdx = idx >= 0 ? idx : 0
  return FLOW_STEPS.slice(0, maxIdx).map((s) => s.id)
}

function getEnabledStepIds(session: SessionData): string[] {
  const current = getCurrentStepId(session)
  const idx = FLOW_STEPS.findIndex((s) => s.id === current)
  const maxIdx = idx >= 0 ? idx : 0
  return FLOW_STEPS.slice(0, maxIdx + 1).map((s) => s.id)
}

export function CardAndQuoteFlow() {
  const { state, refetch } = useSession()
  const [selectedReimbursement, setSelectedReimbursement] = React.useState("70")
  const [selectedDeductible, setSelectedDeductible] = React.useState("500")
  const [transitioning, setTransitioning] = React.useState(false)

  if (state.status !== "ready") return null

  const { session } = state
  const cardImageUrl =
    session.card_image_url ||
    `https://api.petrxbyflex.com/api/card-image/${session.session_id || "preview"}`
  const walletUrl = session.wallet_url
  const products = session.insurance_products ?? []
  const processedPlans = React.useMemo(
    () => processInsuranceProducts(products),
    [products]
  )

  React.useEffect(() => {
    if (processedPlans.defaultPolicy) {
      const d = processedPlans.defaultPolicy
      setSelectedReimbursement(
        Math.round(((d.reimbursement as number) || 0.7) * 100).toString()
      )
      setSelectedDeductible(String(d.deductible ?? "500"))
    }
  }, [processedPlans.defaultPolicy])

  const currentStepId = getCurrentStepId(session)
  const completedStepIds = getCompletedStepIds(session)
  const enabledStepIds = getEnabledStepIds(session)
  const isDesktop = typeof window !== "undefined" && window.innerWidth >= 768

  const handleStepClick = (stepId: string) => {
    const step = FLOW_STEPS.find((s) => s.id === stepId)
    if (step && enabledStepIds.includes(stepId)) {
      window.location.hash = step.route.replace("#", "")
    }
  }

  const handleContinueToDetails = async () => {
    if (state.status !== "ready" || transitioning) return
    setTransitioning(true)
    try {
      await updateSessionStep(session.session_id, "details", {
        plan: {
          reimbursement: selectedReimbursement,
          deductible: selectedDeductible,
        },
      })
      await refetch()
    } catch (e) {
      console.error("Step transition failed:", e)
    } finally {
      setTransitioning(false)
    }
  }

  const petName =
    (session.pet as Record<string, unknown>)?.petName as string ||
    (session.owner as Record<string, unknown>)?.petName as string ||
    "your pet"

  return (
    <div className="card-and-quote-flow">
      <InsuranceProgress
        steps={FLOW_STEPS}
        currentStepId={currentStepId}
        completedStepIds={completedStepIds}
        enabledStepIds={enabledStepIds}
        isCompact={!isDesktop}
        onStepClick={handleStepClick}
      />
      <div className="card-and-quote-grid">
        <section className="card-panel">
          <CardDisplayPanel
            cardImageUrl={cardImageUrl}
            walletUrl={walletUrl}
            memberId={(session as Record<string, unknown>).member_id as string}
            petName={petName}
          />
        </section>
        <section className="quote-panel">
          {processedPlans.allPolicies.length > 0 ? (
            <>
              <InsuranceQuoteSelector
                processedPlans={processedPlans}
                selectedReimbursement={selectedReimbursement}
                selectedDeductible={selectedDeductible}
                onSelectionChange={(r, d) => {
                  setSelectedReimbursement(r)
                  setSelectedDeductible(d)
                }}
                petName={petName}
              />
              <PrimaryCta
                label={transitioning ? "Saving…" : "Continue to Details"}
                onClick={handleContinueToDetails}
                disabled={transitioning}
              />
            </>
          ) : (
            <p>No insurance products available for this session.</p>
          )}
        </section>
      </div>
    </div>
  )
}

function PrimaryCta({
  label,
  onClick,
  disabled,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="primary-cta"
    >
      {label}
    </button>
  )
}
