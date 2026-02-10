import * as React from "react"
import { getBreedAvatarPath } from "../../lib/breedAvatar"

export type ReceiptSidebarProps = {
  currentStep: "quote" | "details" | "payment" | "confirm"
  petName: string
  petType?: string
  petBreed?: string
  petBreedId?: number
  petAge?: string
  planName?: string
  reimbursement?: string
  deductible?: string
  monthlyPrice?: string
  ownerFirstName?: string
  ownerLastName?: string
  ownerEmail?: string
  onEdit?: (step: "quote" | "details" | "payment") => void
}

export function ReceiptSidebar({
  currentStep,
  petName,
  petType = "Dog",
  petBreed,
  petBreedId,
  petAge,
  planName = "Signature Plan",
  reimbursement = "80",
  deductible = "500",
  monthlyPrice = "34.99",
  ownerFirstName,
  ownerLastName,
  ownerEmail,
  onEdit,
}: ReceiptSidebarProps) {
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

  // Pet label: show real name, or "Your Pet" if missing or equals "your pet" (any casing)
  const displayPetName = (() => {
    const t = typeof petName === "string" ? petName.trim() : ""
    if (t.length === 0) return "Your Pet"
    if (t.toLowerCase() === "your pet") return "Your Pet"
    return t
  })()

  const isStepComplete = (step: "quote" | "details" | "payment") => {
    const stepOrder: Record<string, number> = { quote: 1, details: 2, payment: 3, confirm: 4 }
    return stepOrder[currentStep] > stepOrder[step]
  }

  const shouldShowSection = (step: "quote" | "details" | "payment") => {
    const stepOrder: Record<string, number> = { quote: 1, details: 2, payment: 3, confirm: 4 }
    return stepOrder[currentStep] >= stepOrder[step]
  }

  const isConfirmPage = currentStep === "confirm"

  return (
    <div className="receipt-sidebar">
      <div className="receipt-sidebar__content">
        <div className="receipt-sidebar__pet-card">
          <div className="receipt-sidebar__pet-avatar">
            <img src={imgSrc} alt={species} className="receipt-sidebar__pet-icon" onError={handleImgError} />
          </div>
          <div className="receipt-sidebar__pet-info">
            <div className="receipt-sidebar__pet-name">{displayPetName}</div>
            {petBreed && <div className="receipt-sidebar__pet-breed">{petBreed}</div>}
            {petAge && <div className="receipt-sidebar__pet-age">{petAge}</div>}
          </div>
        </div>
        {shouldShowSection("quote") && (
          <div className="receipt-sidebar__section">
            <div className="receipt-sidebar__row">
              <div className="receipt-sidebar__row-content">
                {isStepComplete("quote") && (
                  <svg className="receipt-sidebar__check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={`receipt-sidebar__row-label ${isStepComplete("quote") ? "receipt-sidebar__row-label--complete" : ""}`}>
                  Plan
                </span>
              </div>
              {shouldShowSection("quote") && onEdit && !isConfirmPage && (
                <button
                  type="button"
                  className="receipt-sidebar__edit-btn"
                  onClick={() => onEdit("quote")}
                >
                  Edit
                </button>
              )}
            </div>
            {isStepComplete("quote") && (
              <div className="receipt-sidebar__row-details">
                <div className="receipt-sidebar__detail-row">
                  <span className="receipt-sidebar__detail-label">Plan</span>
                  <span className="receipt-sidebar__detail-value">{planName}</span>
                </div>
                <div className="receipt-sidebar__detail-row">
                  <span className="receipt-sidebar__detail-label">Reimbursement</span>
                  <span className="receipt-sidebar__detail-value">{reimbursement}%</span>
                </div>
                <div className="receipt-sidebar__detail-row">
                  <span className="receipt-sidebar__detail-label">Deductible</span>
                  <span className="receipt-sidebar__detail-value">${deductible}/yr</span>
                </div>
                <div className="receipt-sidebar__detail-row">
                  <span className="receipt-sidebar__detail-label">Monthly</span>
                  <span className="receipt-sidebar__detail-value receipt-sidebar__detail-value--price">${monthlyPrice}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {shouldShowSection("details") && (
          <div className="receipt-sidebar__section">
            <div className="receipt-sidebar__row">
              <div className="receipt-sidebar__row-content">
                {isStepComplete("details") && (
                  <svg className="receipt-sidebar__check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={`receipt-sidebar__row-label ${isStepComplete("details") ? "receipt-sidebar__row-label--complete" : ""}`}>
                  Your details
                </span>
              </div>
              {shouldShowSection("details") && onEdit && !isConfirmPage && (
                <button
                  type="button"
                  className="receipt-sidebar__edit-btn"
                  onClick={() => onEdit("details")}
                >
                  Edit
                </button>
              )}
            </div>
            {isStepComplete("details") && (
              <div className="receipt-sidebar__row-details">
                {ownerFirstName && ownerLastName && (
                  <div className="receipt-sidebar__detail-row">
                    <span className="receipt-sidebar__detail-value receipt-sidebar__detail-value--owner">{ownerFirstName} {ownerLastName}</span>
                  </div>
                )}
                {ownerEmail && (
                  <div className="receipt-sidebar__detail-row">
                    <span className="receipt-sidebar__detail-value receipt-sidebar__detail-value--owner">{ownerEmail}</span>
                  </div>
                )}
                {(ownerFirstName || ownerLastName || ownerEmail) && (
                  <div className="receipt-sidebar__detail-row">
                    <span className="receipt-sidebar__detail-more">... (more)</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {shouldShowSection("payment") && (
          <div className="receipt-sidebar__section">
            <div className="receipt-sidebar__row">
              <div className="receipt-sidebar__row-content">
                {isStepComplete("payment") && (
                  <svg className="receipt-sidebar__check" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M13.333 4L6 11.333 2.667 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                <span className={`receipt-sidebar__row-label ${isStepComplete("payment") ? "receipt-sidebar__row-label--complete" : ""}`}>
                  Payment
                </span>
              </div>
              {shouldShowSection("payment") && onEdit && !isConfirmPage && (
                <button
                  type="button"
                  className="receipt-sidebar__edit-btn"
                  onClick={() => onEdit("payment")}
                >
                  Edit
                </button>
              )}
            </div>
            {isStepComplete("payment") && (
              <div className="receipt-sidebar__row-details">
                <div className="receipt-sidebar__detail-row">
                  <span className="receipt-sidebar__detail-label">Status</span>
                  <span className="receipt-sidebar__detail-value">Paid</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
