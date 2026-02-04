import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { getMockStep } from "../mocks/mockMode"
import { useSession } from "../context/SessionContext"
import { updateSessionStep } from "../api/session"
import { CardDisplayPanel } from "./CardDisplayPanel"
import { WalletModal } from "./WalletModal"
import { StepProgress } from "./StepProgress"
import { InsuranceQuoteSelector } from "./InsuranceQuoteSelector"
import type { ProcessedPlans } from "./InsuranceQuoteSelector"

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

export function CardAndQuoteFlow() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { state, refetch } = useSession()
  const mockStep = getMockStep()
  const [selectedReimbursement, setSelectedReimbursement] = React.useState("70")
  const [selectedDeductible, setSelectedDeductible] = React.useState("500")
  const [transitioning, setTransitioning] = React.useState(false)
  const [transitionError, setTransitionError] = React.useState<string | null>(null)
  const [walletModalOpen, setWalletModalOpen] = React.useState(false)

  if (state.status !== "ready") return null

  const { session } = state
  const cardImageUrl = session.card_image_url ?? undefined
  const walletUrl = session.wallet_url ?? session.wallet_pass_url ?? undefined
  const memberId = (session as Record<string, unknown>).member_id as string | undefined
  const products = Array.isArray(session.insurance_products) ? session.insurance_products : []
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

  const handleContinueToDetails = async () => {
    if (state.status !== "ready" || transitioning) return
    setTransitionError(null)
    if (mockStep) {
      const next = new URLSearchParams(searchParams)
      next.set("mock", "details")
      setSearchParams(next, { replace: true })
      return
    }
    setTransitioning(true)
    try {
      await updateSessionStep(session.session_id, "details", {
        plan: {
          reimbursement: selectedReimbursement,
          deductible: selectedDeductible,
        },
      })
      await refetch()
    } catch {
      setTransitionError("Something went wrong. Please try again.")
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
      <StepProgress
        steps={[
          { key: "quote", label: "Quote" },
          { key: "details", label: "Details" },
          { key: "payment", label: "Payment" },
          { key: "confirm", label: "Confirm" },
        ]}
        currentKey={(session.current_step ?? "quote").toLowerCase()}
      />
      <div className="card-and-quote-grid">
        <section className="card-panel">
          {cardImageUrl ? (
            <CardDisplayPanel
              cardImageUrl={cardImageUrl}
              walletUrl={walletUrl}
              memberId={memberId}
              petName={petName}
              onAddToWallet={() => setWalletModalOpen(true)}
            />
          ) : (
            <div className="cardPanel card-display-panel-empty">
              <div className="cardPanel__header">
                <h2>Your Digital Card</h2>
              </div>
              <p className="cardPanel__note">Card image will appear when available.</p>
            </div>
          )}
          <WalletModal
            open={walletModalOpen}
            onClose={() => setWalletModalOpen(false)}
            qrCodeUrl={session.qr_code_url}
            qrCodeUrlAndroid={session.qr_code_url_android}
            walletPassUrl={session.wallet_pass_url ?? walletUrl}
            memberId={memberId}
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
              {transitionError && (
                <p className="start-error" style={{ marginTop: 12, marginBottom: 0 }}>
                  {transitionError}
                </p>
              )}
            </>
          ) : (
            <div className="quoteEmpty">
              <h3>Insurance Quotes Coming Soon</h3>
              <p>
                We&apos;re preparing personalized insurance options for your pet.
                You can save your PetRx card now — we&apos;ll notify you when quotes are ready.
              </p>
            </div>
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
      className="btn btn--primary"
    >
      {label}
    </button>
  )
}
