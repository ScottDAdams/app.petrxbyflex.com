import { PartnerBar } from "../../components/insurance/PartnerBar"
import { OneIncModalLauncher } from "../../components/insurance/OneIncModalLauncher"
import { PrimaryActionButton } from "../../components/ui/PrimaryActionButton"

export type PaymentStepProps = {
  onBack?: () => void
  onReview?: () => void
  reviewLabel?: string
  reviewDisabled?: boolean
  onPaymentSuccess?: (result: { paymentToken: string; transactionId: string; paymentMethod?: "CreditCard" | "ECheck"; convenienceFee?: number }) => void
  leadId?: string
  accountId?: string
  amount?: number
  /** Optional: pass through from SetupPending so OneInc init can use portalOneSessionKey without DB lookup */
  oneincModalData?: Record<string, unknown> | null
}

export function PaymentStep({
  onBack,
  onReview,
  reviewLabel = "Review & Confirm",
  reviewDisabled = false,
  onPaymentSuccess,
  leadId,
  accountId,
  amount,
  oneincModalData,
}: PaymentStepProps) {
  return (
    <div className="step-body step-body--payment">
      <PartnerBar />
      <h2 className="step-body__title">Payment</h2>
      <p className="step-body__subtitle">
        Enter your payment details to continue.
      </p>
      <div className="payment-container payment-container--full">
        <div className="payment-main payment-main--full">
          <div className="payment-method-card">
            <h3 className="payment-method-card__title">Payment method</h3>
            <div id="oneinc-container" className="oneinc-container">
              <OneIncModalLauncher
                onPaymentSuccess={(result) => {
                  if (onPaymentSuccess) {
                    onPaymentSuccess(result)
                  }
                }}
                leadId={leadId}
                accountId={accountId}
                amount={amount}
                oneincModalData={oneincModalData}
                disabled={!leadId || !accountId || amount == null || amount <= 0}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="step-actions">
        {onBack && (
          <button type="button" className="btn btn--secondary step-actions__back" onClick={onBack}>
            ← Back
          </button>
        )}
        {onReview && (
          <PrimaryActionButton
            onAction={onReview}
            disabled={reviewDisabled}
            className={`btn btn--primary step-actions__continue`}
          >
            {reviewLabel}
          </PrimaryActionButton>
        )}
      </div>
    </div>
  )
}
