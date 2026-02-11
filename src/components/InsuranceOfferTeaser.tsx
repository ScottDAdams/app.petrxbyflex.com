import { HealthyPawsLogo } from "./HealthyPawsLogo"

export type InsuranceOfferTeaserProps = {
  petName: string
  /** Starting price in dollars (e.g. 29.99); omit if not available */
  startingPriceMo?: number | null
  /** "See coverage options" click → expand to full QuoteStep */
  onExpand: () => void
  /** "Not now" click → hide teaser for this page view only (no persist) */
  onDismiss: () => void
  /** When true, use stronger post-save copy: "Want to protect <petname> from vet bills?" */
  postSaveCopy?: boolean
}

export function InsuranceOfferTeaser({
  petName,
  startingPriceMo,
  onExpand,
  onDismiss,
  postSaveCopy = false,
}: InsuranceOfferTeaserProps) {
  const displayName = petName && petName.trim() ? petName.trim() : "your pet"
  const priceStr =
    startingPriceMo != null && Number.isFinite(startingPriceMo)
      ? `Starting at $${Number(startingPriceMo).toFixed(2)}/mo`
      : null

  return (
    <div className="insurance-teaser" role="region" aria-label="Optional insurance offer">
      <div className="insurance-teaser__header">
        <HealthyPawsLogo size="md" className="insurance-teaser__logo" />
        <h3 className="insurance-teaser__title">
          {postSaveCopy
            ? `Want to protect ${displayName} from vet bills?`
            : `Optional coverage for ${displayName}`}
        </h3>
      </div>
      {!postSaveCopy && (
        <ul className="insurance-teaser__bullets">
          <li>Unlimited lifetime benefits</li>
          <li>Fast, simple claims</li>
          <li>No network restrictions</li>
        </ul>
      )}
      {postSaveCopy && (
        <p className="insurance-teaser__post-save">
          Healthy Paws pet insurance can help cover unexpected vet costs. Optional — explore below if you&apos;re interested.
        </p>
      )}
      {priceStr && (
        <p className="insurance-teaser__price">{priceStr}</p>
      )}
      <div className="insurance-teaser__actions">
        <button type="button" className="btn btn--primary insurance-teaser__cta" onClick={onExpand}>
          See coverage options
        </button>
        <button
          type="button"
          className="insurance-teaser__dismiss"
          onClick={onDismiss}
          aria-label="Not now"
        >
          Not now
        </button>
      </div>
    </div>
  )
}
