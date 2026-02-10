import * as React from "react"
import { getBreedAvatarPath } from "../lib/breedAvatar"

export type PetSidebarProps = {
  petName: string
  petType?: string
  petBreed?: string
  petBreedId?: number
  petAge?: string
  planName?: string
  reimbursement?: string
  deductible?: string
  monthlyPrice?: string
  onEditQuote?: () => void
}

export function PetSidebar({
  petName,
  petType = "Dog",
  petBreed = "Mixed",
  petBreedId,
  petAge,
  planName = "Signature Plan",
  reimbursement = "80",
  deductible = "500",
  monthlyPrice = "34.99",
  onEditQuote,
}: PetSidebarProps) {
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
    <div className="petSidebar">
      <div className="petSidebar__header">
        <h3 className="petSidebar__title">Pet Information</h3>
      </div>
      <div className="petSidebar__content">
        <div className="petSidebar__petCard">
          <div className="petSidebar__petAvatar">
          <img src={imgSrc} alt={species} className="petSidebar__petIcon" onError={handleImgError} />
        </div>
          <div className="petSidebar__petInfo">
            <div className="petSidebar__petName">{petName}</div>
            {petBreed && <div className="petSidebar__petBreed">{petBreed}</div>}
            {petAge && <div className="petSidebar__petAge">{petAge}</div>}
          </div>
        </div>
        <div className="petSidebar__section">
          <div className="petSidebar__label">Plan</div>
          <div className="petSidebar__value">{planName}</div>
          <div className="petSidebar__label">Reimbursement</div>
          <div className="petSidebar__value">{reimbursement}%</div>
          <div className="petSidebar__label">Deductible</div>
          <div className="petSidebar__value">${deductible}/yr</div>
          <div className="petSidebar__label">Monthly</div>
          <div className="petSidebar__value petSidebar__value--price">${monthlyPrice}</div>
        </div>
        {onEditQuote && (
          <div className="petSidebar__section">
            <button type="button" className="petSidebar__editLink" onClick={onEditQuote}>
              Edit quote
            </button>
            <p className="petSidebar__editWarning">
              Changing your quote may update pricing.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
