import * as React from "react"
import type { ProcessedPlans } from "../../components/InsuranceQuoteSelector"
import { QuoteNarrativeHeader } from "../../components/quote/QuoteNarrativeHeader"
import { QuoteBreedInsightsSection } from "../../components/quote/QuoteBreedInsightsSection"
import { getBreedAvatarPath } from "../../lib/breedAvatar"
import { PrimaryActionButton } from "../../components/ui/PrimaryActionButton"
import type { EnrollmentEventMetadata } from "../../api/analytics"

export type QuoteStepProps = {
  processedPlans: ProcessedPlans
  selectedPlanId: "signature" | "value"
  selectedReimbursement: string
  selectedDeductible: string
  onPlanChange: (planId: "signature" | "value") => void
  onSelectionChange: (r: string, d: string) => void
  petName: string
  petType?: string
  petBreedId?: number
  petBreedLabel?: string
  petAge?: string
  petGender?: string
  disabled?: boolean
  onContinue?: () => void
  continueLabel?: string
  continueDisabled?: boolean
  analyticsMetadata?: EnrollmentEventMetadata
  onBreedInsightsShown?: () => void
  /** Override main title (e.g. card-first: "Bonus: Protect ...") */
  title?: string
  /** Override subtitle (e.g. card-first: "Healthy Paws coverage options (optional)") */
  subtitle?: string
  /** "secondary" = reduced visual dominance (smaller header, price not hero) */
  variant?: "default" | "secondary"
}

export function QuoteStep({
  processedPlans,
  selectedPlanId,
  selectedReimbursement,
  selectedDeductible,
  onPlanChange,
  onSelectionChange,
  petName,
  petType = "Dog",
  petBreedId,
  petBreedLabel,
  petAge,
  petGender,
  disabled = false,
  onContinue,
  continueLabel = "Review Your Details",
  continueDisabled = false,
  analyticsMetadata,
  onBreedInsightsShown,
  title: _titleOverride,
  subtitle: _subtitleOverride,
  variant = "default",
}: QuoteStepProps) {
  const isSignature = selectedPlanId === "signature"
  const displayPetName = petName && petName.trim().length > 0 ? petName.trim() : "Your Pet"
  
  // Pet avatar logic (same as ReceiptSidebar)
  const species = (petType ?? "dog").toLowerCase()
  const speciesKey = species === "cat" ? "cats" : "dogs"
  const iconSrc = getBreedAvatarPath(speciesKey, petBreedId)
  const defaultIconSrc = getBreedAvatarPath(speciesKey, null)
  const [imgSrc, setImgSrc] = React.useState(iconSrc)

  React.useEffect(() => {
    setImgSrc(getBreedAvatarPath(speciesKey, petBreedId))
  }, [speciesKey, petBreedId])

  const handleImgError = () => {
    setImgSrc(defaultIconSrc)
  }
  
  // Derive available options from HP-returned policies only, grouped by isHighDeductible
  const availableReimbursements = React.useMemo(() => {
    if (!isSignature) return []
    // For Signature plan (isHighDeductible: false), show all reimbursements HP returned
    const signaturePolicies = processedPlans.allPolicies.filter(
      (p) => (p.isHighDeductible as boolean) === false
    )
    return processedPlans.allReimbursements.filter((r) => {
      // Only show if there's at least one Signature policy with this reimbursement
      return signaturePolicies.some(
        (p) => Math.round(((p.reimbursement as number) || 0) * 100).toString() === r
      )
    })
  }, [isSignature, processedPlans.allReimbursements, processedPlans.allPolicies])

  const availableDeductibles = React.useMemo(() => {
    // Filter policies by plan type (Signature vs Value) using isHighDeductible
    const planTypePolicies = processedPlans.allPolicies.filter(
      (p) => (p.isHighDeductible as boolean) === !isSignature
    )
    // Then filter by selected reimbursement
    const r = selectedReimbursement || "70"
    const matchingPolicies = planTypePolicies.filter(
      (p) => Math.round(((p.reimbursement as number) || 0) * 100).toString() === r
    )
    const deductibles = [
      ...new Set(matchingPolicies.map((p) => String(p.deductible ?? "0"))),
    ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
    return deductibles
  }, [processedPlans.allPolicies, selectedReimbursement, isSignature])

  // For Value plan, reimbursement is fixed at what HP returned (usually 80%)
  const valueReimbursement = React.useMemo(() => {
    if (isSignature) return null
    // Find the reimbursement for Value plan (isHighDeductible: true)
    const valuePolicy = processedPlans.allPolicies.find(
      (p) => (p.isHighDeductible as boolean) === true
    )
    if (valuePolicy) {
      return Math.round(((valuePolicy.reimbursement as number) || 0) * 100).toString()
    }
    return "80" // fallback
  }, [isSignature, processedPlans.allPolicies])

  const handleReimbursementChange = (r: string) => {
    onSelectionChange(r, selectedDeductible)
  }

  const handleDeductibleChange = (d: string) => {
    onSelectionChange(selectedReimbursement, d)
  }

  // Find the actual policy match - NO mock pricing fallback
  // Must match reimbursement, deductible, AND plan type (isHighDeductible)
  const currentPolicy = React.useMemo(() => {
    return processedPlans.allPolicies.find(
      (p) =>
        (p.isHighDeductible as boolean) === !isSignature &&
        Math.round(((p.reimbursement as number) || 0) * 100).toString() === selectedReimbursement &&
        String(p.deductible) === selectedDeductible
    )
  }, [processedPlans.allPolicies, selectedReimbursement, selectedDeductible, isSignature])

  const currentPricing = currentPolicy
    ? (currentPolicy?.monthly_premium as string) ?? (currentPolicy?.monthly_price as string) ?? "0.00"
    : null // No mock pricing - show "Not available" if no match

  return (
    <div className={`quote-step ${variant === "secondary" ? "quote-step--secondary" : ""}`}>
      <QuoteNarrativeHeader
        petName={displayPetName}
        petBreedLabel={petBreedLabel}
        petAge={petAge}
        petGender={petGender}
        avatarSrc={imgSrc}
        avatarAlt={`${species} breed avatar`}
        onAvatarError={handleImgError}
      />
      <QuoteBreedInsightsSection
        petBreedLabel={petBreedLabel ?? "this breed"}
        speciesType={(petType ?? "dog").toUpperCase()}
        breedTypeId={petBreedId}
        analyticsMetadata={analyticsMetadata}
        onTrackShown={onBreedInsightsShown}
      />
      <div className="quote-insurance-offer">
        <h3 className="quote-insurance-offer__headline">Pair Your Free PetRx Card with Pet Insurance</h3>
        <p className="quote-insurance-offer__subtext">
          Pet insurance from Healthy Paws can help manage unexpected veterinary expenses while supporting {displayPetName}&apos;s ongoing care.
        </p>
      </div>
      <div className="plan-selector" id="plan-selector">
        <h4 className="plan-selector__title">Select a plan</h4>
        <div className="plan-selector__grid">
          <button
            type="button"
            className={`plan-selector__card ${isSignature ? "plan-selector__card--active" : ""}`}
            onClick={() => onPlanChange("signature")}
            disabled={disabled}
          >
            {isSignature && <div className="plan-selector__badge">Most Popular</div>}
            <div className="plan-selector__name">Signature Plan</div>
            <div className="plan-selector__desc">Full coverage with flexible options</div>
          </button>
          <button
            type="button"
            className={`plan-selector__card ${!isSignature ? "plan-selector__card--active" : ""}`}
            onClick={() => onPlanChange("value")}
            disabled={disabled}
          >
            <div className="plan-selector__name">Value Plan</div>
            <div className="plan-selector__desc">Lower monthly cost, higher deductibles</div>
          </button>
        </div>
      </div>
      <div className={`plan-container plan-container--${selectedPlanId}`}>
        <div className="plan-container__header">
          <h4 className="plan-container__title">
            {isSignature ? "Signature Plan" : "Value Plan"}
            {isSignature && <span className="plan-container__badge">Most Popular</span>}
          </h4>
        </div>
        <div className="plan-container__options">
          {isSignature && (
            <>
              <h4 className="plan-options__title">Reimbursement</h4>
              <div className="plan-options__grid">
                {availableReimbursements.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`plan-options__btn ${selectedReimbursement === r ? "plan-options__btn--active" : ""}`}
                    onClick={() => handleReimbursementChange(r)}
                    disabled={disabled}
                  >
                    {r}%
                  </button>
                ))}
              </div>
            </>
          )}
          {!isSignature && (
            <div className="plan-options__fixed">
              <span className="plan-options__fixed-label">Reimbursement</span>
              <span className="plan-options__fixed-value">{valueReimbursement}% (fixed)</span>
            </div>
          )}
          <h4 className="plan-options__title">Annual Deductible</h4>
          {availableDeductibles.length === 0 ? (
            <div className="plan-options__empty">
              <p style={{ color: "#666", fontSize: "14px" }}>No deductible options available for this reimbursement level.</p>
            </div>
          ) : (
            <div className="plan-options__grid">
              {availableDeductibles.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`plan-options__btn ${selectedDeductible === d ? "plan-options__btn--active" : ""}`}
                  onClick={() => handleDeductibleChange(d)}
                  disabled={disabled}
                >
                  ${d}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="plan-container__summary">
          <div className="quote-summary-card">
            <div className="quote-summary-card__content">
              <div className="quote-summary-card__price">
                <div className="quote-summary-card__price-label">Starting at just</div>
                {currentPricing ? (
                  <div className="quote-summary-card__price-amount">
                    ${currentPricing}
                    <span className="quote-summary-card__price-period">/month</span>
                  </div>
                ) : (
                  <div className="quote-summary-card__price-amount" style={{ color: "#999", fontSize: "1.2em" }}>
                    Not available
                  </div>
                )}
              </div>
              <div className="quote-summary-card__details">
                <div className="quote-summary-card__detail">
                  <span className="quote-summary-card__detail-value">{selectedReimbursement}%</span>
                  <span className="quote-summary-card__detail-label">Reimbursement</span>
                </div>
                <div className="quote-summary-card__detail">
                  <span className="quote-summary-card__detail-value">${selectedDeductible}</span>
                  <span className="quote-summary-card__detail-label">Annual Deductible</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {onContinue && (
          <div className="plan-container__cta">
            <PrimaryActionButton
              onAction={onContinue}
              disabled={continueDisabled || !currentPolicy}
              className={`btn btn--primary ${continueDisabled || !currentPolicy ? "btn--loading" : ""}`}
              title={!currentPolicy ? "Please select a plan option that is available for your pet" : undefined}
            >
              {continueDisabled && <span className="btn-spinner" aria-hidden />}
              {continueLabel}
            </PrimaryActionButton>
            {!currentPolicy && (
              <p style={{ marginTop: "8px", fontSize: "12px", color: "#d32f2f", textAlign: "center" }}>
                This plan combination is not available for your pet. Please select a different option.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
