import { HealthyPawsLogo } from "../HealthyPawsLogo"

export interface QuoteNarrativeHeaderProps {
  petName: string
  petBreedLabel?: string
  petAge?: string
  petGender?: string
  avatarSrc: string
  avatarAlt: string
  onAvatarError?: () => void
}

function formatGender(s: string | undefined): string | undefined {
  if (!s || typeof s !== "string") return undefined
  const t = s.trim().toLowerCase()
  if (t === "male") return "Male"
  if (t === "female") return "Female"
  return undefined
}

export function QuoteNarrativeHeader({
  petName,
  petBreedLabel,
  petAge,
  petGender,
  avatarSrc,
  avatarAlt,
  onAvatarError,
}: QuoteNarrativeHeaderProps) {
  const displayName = petName && petName.trim() ? petName.trim() : "Your Pet"
  const breed = petBreedLabel && petBreedLabel.trim() ? petBreedLabel.trim() : undefined
  const age = petAge && petAge.trim() ? petAge.trim() : undefined
  const gender = formatGender(petGender)

  const subtextParts = [breed, age, gender].filter(Boolean)
  const subtext = subtextParts.join(" • ")

  return (
    <div className="quote-narrative-header">
      <div className="quote-narrative-header__partner-banner" aria-label="Brought to you by our partner Healthy Paws">
        <div className="quote-narrative-header__partner-banner-text">
          <span className="quote-narrative-header__partner-banner-title">Brought to you by our partner Healthy Paws</span>
          <span className="quote-narrative-header__partner-banner-tagline">Trusted by pet parents nationwide</span>
        </div>
        <HealthyPawsLogo size="sm" />
      </div>
      <div className="quote-narrative-header__main">
        <div className="quote-narrative-header__avatar">
          <img src={avatarSrc} alt={avatarAlt} className="quote-narrative-header__avatar-img" onError={onAvatarError} />
        </div>
        <div className="quote-narrative-header__text">
          <h2 className="quote-narrative-header__headline">
            Complete Care for {displayName}
          </h2>
          {subtext && (
            <p className="quote-narrative-header__subtext">{subtext}</p>
          )}
        </div>
      </div>
    </div>
  )
}
