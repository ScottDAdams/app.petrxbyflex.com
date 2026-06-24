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
  /**
   * OneInc payment receipt (server-persisted from /api/oneinc/complete). Shown
   * as a confirmation block so the buyer sees the actual charge instead of a
   * vague "payment added" message. Omitted/undefined renders nothing.
   */
  payment?: {
    method?: "CreditCard" | "ECheck"
    cardType?: string
    amountCharged?: number
    convenienceFee?: number
    transactionId?: string
    status?: string
  }
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
  payment,
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

  // Payment receipt (OneInc). Only render when we have a real charge to show.
  const fmtMoney = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const payMethodLabel =
    payment?.method === "ECheck"
      ? "Bank account"
      : payment?.cardType
        ? `Credit card (${payment.cardType})`
        : payment?.method === "CreditCard"
          ? "Credit card"
          : undefined
  const hasAmountCharged =
    typeof payment?.amountCharged === "number" && payment.amountCharged > 0
  const hasConvenienceFee =
    typeof payment?.convenienceFee === "number" && payment.convenienceFee > 0
  const showPaymentReceipt = Boolean(
    payment && (hasAmountCharged || payMethodLabel || payment.transactionId)
  )

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

      {showPaymentReceipt && (
        <div className="confirm-receipt">
          <h3 className="confirm-receipt__title">
            <span className="confirm-receipt__check" aria-hidden="true">
              <svg width="12" height="12" viewBox="0 0 20 20" fill="none">
                <path d="M16.667 5L7.5 14.167 3.333 10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Payment received
          </h3>
          <div className="step-summary step-summary--confirm">
            {hasAmountCharged && (
              <div className="step-summary__row">
                <span className="step-summary__label">Amount charged</span>
                <span className="step-summary__value">${fmtMoney(payment!.amountCharged!)}</span>
              </div>
            )}
            {payMethodLabel && (
              <div className="step-summary__row">
                <span className="step-summary__label">Payment method</span>
                <span className="step-summary__value">{payMethodLabel}</span>
              </div>
            )}
            {hasConvenienceFee && (
              <div className="step-summary__row">
                <span className="step-summary__label">Convenience fee</span>
                <span className="step-summary__value">${fmtMoney(payment!.convenienceFee!)}</span>
              </div>
            )}
            {payment?.transactionId && (
              <div className="step-summary__row">
                <span className="step-summary__label">Transaction ID</span>
                <span className="step-summary__value">{payment.transactionId}</span>
              </div>
            )}
            <div className="step-summary__row">
              <span className="step-summary__label">Status</span>
              <span className="step-summary__value">{payment?.status || "Approved"}</span>
            </div>
          </div>
        </div>
      )}

      <div className="confirm-petrx-note">
        <p className="confirm-petrx-note__text">
          Your PetRx savings card can be used right away — even before coverage begins.
        </p>
      </div>
    </div>
  )
}
