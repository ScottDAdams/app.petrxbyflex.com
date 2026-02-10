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
  policyNumber?: string
  effectiveDate?: string
}

export function ConfirmStep({
  petName,
  petType = "Dog",
  petBreedId,
  planName = "Signature Plan",
  deductible = "500",
  reimbursement = "80",
  monthlyPrice = "34.99",
  policyNumber = "HP-2024-12345",
  effectiveDate = "February 1, 2024",
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

  return (
    <div className="step-body step-body--confirm">
      <SuccessPartnerHeader />
      <div className="confirm-welcome">
        <div className="confirm-welcome__content">
          <div className="confirm-welcome__left">
            <div className="confirm-welcome__pet-avatar">
            <img src={imgSrc} alt={species} className="confirm-welcome__pet-image" onError={handleImgError} />
          </div>
          </div>
          <div className="confirm-welcome__right">
            <h2 className="confirm-welcome__title">Coverage for {petName} is Activated</h2>
            <p className="confirm-welcome__message">
              Check your email for policy documents and next steps.
            </p>
          </div>
        </div>
      </div>
      <div className="confirm-next-steps">
        <h3 className="confirm-next-steps__title">Next steps</h3>
        <div className="confirm-next-steps__list">
          <div className="confirm-next-steps__item">
            <div className="confirm-next-steps__bullet"></div>
            <div className="confirm-next-steps__content">
              <span className="confirm-next-steps__text">Policy created</span>
            </div>
          </div>
          <div className="confirm-next-steps__item">
            <div className="confirm-next-steps__bullet"></div>
            <div className="confirm-next-steps__content">
              <span className="confirm-next-steps__text">Confirmation email sent</span>
            </div>
          </div>
          <div className="confirm-next-steps__item">
            <div className="confirm-next-steps__bullet"></div>
            <div className="confirm-next-steps__content">
              <span className="confirm-next-steps__text">
                <strong>Coverage begins</strong> {effectiveDate}
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
          <div className="step-summary__row">
            <span className="step-summary__label">Plan</span>
            <span className="step-summary__value">{planName}</span>
          </div>
          <div className="step-summary__row">
            <span className="step-summary__label">Annual deductible</span>
            <span className="step-summary__value">${deductible}</span>
          </div>
          <div className="step-summary__row">
            <span className="step-summary__label">Reimbursement</span>
            <span className="step-summary__value">{reimbursement}%</span>
          </div>
          <div className="step-summary__row">
            <span className="step-summary__label">Monthly premium</span>
            <span className="step-summary__value">${monthlyPrice}</span>
          </div>
          {policyNumber && (
            <div className="step-summary__row">
              <span className="step-summary__label">Policy number</span>
              <span className="step-summary__value">{policyNumber}</span>
            </div>
          )}
          {effectiveDate && (
            <div className="step-summary__row">
              <span className="step-summary__label">Effective date</span>
              <span className="step-summary__value">{effectiveDate}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
