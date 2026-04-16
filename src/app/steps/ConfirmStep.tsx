import * as React from "react"
import { SuccessPartnerHeader } from "../../components/insurance/SuccessPartnerHeader"
import { getBreedAvatarPath } from "../../lib/breedAvatar"

export type ConfirmStepProps = {
  petName: string
  petType?: string
  petBreedId?: number
  planName?: string
  deductible?: string
  reimbursement?: string
  monthlyPrice?: string
  /** HP Enroll response timed out; enrollment may still complete server-side */
  pendingConfirmation?: boolean
  /**
   * Healthy Paws account handoff URL from HP Enroll (`registrationRedirectUrl`).
   * User completes activation on HP; not documented in our UI spec beyond this CTA.
   */
  healthyPawsHandoffUrl?: string | null
}

export function ConfirmStep({
  petName,
  petType = "Dog",
  petBreedId,
  planName,
  deductible,
  reimbursement,
  monthlyPrice,
  pendingConfirmation = false,
  healthyPawsHandoffUrl,
}: ConfirmStepProps) {
  const species = (petType ?? "dog").toLowerCase()
  const speciesKey = species === "cat" ? "cats" : "dogs"
  const iconSrc = getBreedAvatarPath(speciesKey, petBreedId)
  const defaultIconSrc = getBreedAvatarPath(speciesKey, null)
  const [imgSrc, setImgSrc] = React.useState(iconSrc)

  React.useEffect(() => {
    setImgSrc(getBreedAvatarPath(speciesKey, petBreedId))
  }, [speciesKey, petBreedId])

  const handleImgError = () => setImgSrc(defaultIconSrc)

  const handoff = typeof healthyPawsHandoffUrl === "string" ? healthyPawsHandoffUrl.trim() : ""
  const showEnrolledSuccess = !pendingConfirmation

  const hasPlanName = Boolean(planName && planName.trim())
  const hasDeductible = Boolean(deductible && String(deductible).trim())
  const hasReimbursement = Boolean(reimbursement && String(reimbursement).trim())
  const hasMonthly = Boolean(monthlyPrice && String(monthlyPrice).trim())

  return (
    <div className="step-body step-body--confirm">
      <SuccessPartnerHeader />
      {pendingConfirmation && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginBottom: 20,
            padding: "14px 16px",
            borderRadius: 6,
            background: "linear-gradient(135deg, #f0f7ff 0%, #e8f4fc 100%)",
            border: "1px solid #b8d4e8",
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ display: "block", marginBottom: 6 }}>Processing your enrollment</strong>
          This may take a moment. Do not refresh or submit payment again — we are confirming your
          enrollment with Healthy Paws. You can leave this page open; we will update when ready.
        </div>
      )}

      {showEnrolledSuccess && (
        <div className="confirm-welcome">
          <div className="confirm-welcome__content">
            <div className="confirm-welcome__left">
              <div className="confirm-welcome__pet-avatar">
                <img
                  src={imgSrc}
                  alt={species}
                  className="confirm-welcome__pet-image"
                  onError={handleImgError}
                />
              </div>
            </div>
            <div className="confirm-welcome__right">
              <h2 className="confirm-welcome__title">
                You have now enrolled {petName} in Healthy Paws
              </h2>
              <p className="confirm-welcome__message">
                Your enrollment was submitted successfully. Continue to Healthy Paws to finish
                setting up and activating your account. Also watch for email(s) from Healthy Paws
                with your policy details and next steps.
              </p>
              {handoff ? (
                <div className="confirm-welcome__cta">
                  <a
                    className="btn btn--primary confirm-welcome__cta-button"
                    href={handoff}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Continue to Healthy Paws
                  </a>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      <div className="confirm-next-steps">
        <h3 className="confirm-next-steps__title">Next steps</h3>
        <div className="confirm-next-steps__list">
          <div className="confirm-next-steps__item">
            <div className="confirm-next-steps__bullet"></div>
            <div className="confirm-next-steps__content">
              <span className="confirm-next-steps__text">
                {pendingConfirmation
                  ? "Enrollment confirmation (in progress)"
                  : "Enrollment submitted to Healthy Paws"}
              </span>
            </div>
          </div>
          {!pendingConfirmation && handoff && (
            <div className="confirm-next-steps__item">
              <div className="confirm-next-steps__bullet"></div>
              <div className="confirm-next-steps__content">
                <span className="confirm-next-steps__text">
                  Continue to Healthy Paws to finish setting up your account
                </span>
              </div>
            </div>
          )}
          <div className="confirm-next-steps__item">
            <div className="confirm-next-steps__bullet"></div>
            <div className="confirm-next-steps__content">
              <span className="confirm-next-steps__text">
                Watch your inbox for Healthy Paws emails with your policy details and next steps
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="confirm-petrx-note">
        <p className="confirm-petrx-note__text">
          Your PetRx savings card can be used right away — even before coverage begins.
        </p>
      </div>
      <div className="confirm-summary">
        <h3 className="confirm-summary__title">Policy information</h3>
        <div className="step-summary step-summary--confirm">
          <div className="step-summary__row">
            <span className="step-summary__label">Pet</span>
            <span className="step-summary__value">{petName}</span>
          </div>
          {hasPlanName && (
            <div className="step-summary__row">
              <span className="step-summary__label">Plan</span>
              <span className="step-summary__value">{planName}</span>
            </div>
          )}
          {hasDeductible && (
            <div className="step-summary__row">
              <span className="step-summary__label">Annual deductible</span>
              <span className="step-summary__value">${deductible}</span>
            </div>
          )}
          {hasReimbursement && (
            <div className="step-summary__row">
              <span className="step-summary__label">Reimbursement</span>
              <span className="step-summary__value">{reimbursement}%</span>
            </div>
          )}
          {hasMonthly && (
            <div className="step-summary__row">
              <span className="step-summary__label">Monthly premium</span>
              <span className="step-summary__value">${monthlyPrice}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
