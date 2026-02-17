import * as React from "react"
import type { EnrollmentEventMetadata } from "../../api/analytics"
import { useBreedInsights } from "../../hooks/useBreedInsights"

export type QuoteBreedInsightsSectionProps = {
  petBreedLabel: string
  speciesType: string
  breedTypeId?: number | null
  analyticsMetadata?: EnrollmentEventMetadata & { breed_type_id?: number | null; speciesType?: string }
  onTrackShown?: () => void
}

export function QuoteBreedInsightsSection({
  petBreedLabel,
  speciesType,
  breedTypeId,
  analyticsMetadata,
  onTrackShown,
}: QuoteBreedInsightsSectionProps) {
  const { aboutBullets, considerationBullets, isLoading, hasContent } = useBreedInsights(
    speciesType,
    breedTypeId,
    analyticsMetadata
  )

  React.useEffect(() => {
    if (onTrackShown) onTrackShown()
  }, [onTrackShown])

  const breedDisplay = petBreedLabel && petBreedLabel.trim() ? petBreedLabel.trim() : "this breed"
  const showAbout = hasContent && aboutBullets.length > 0
  const showConsiderations = hasContent && considerationBullets.length > 0
  const showAnyInsights = showAbout || showConsiderations

  // Hide entire block if no content (no empty section headers)
  if (!showAnyInsights && !isLoading) return null
  // Minimal loading state; does not block quote selection
  if (isLoading) {
    return (
      <div className="quote-breed-insights quote-breed-insights--loading" aria-busy="true">
        <p className="quote-breed-insights__loading">Loading breed insights…</p>
      </div>
    )
  }

  return (
    <div className="quote-breed-insights">
      {showAbout && (
        <section className="quote-breed-insights__section" aria-labelledby="insights-about-heading">
          <h3 id="insights-about-heading" className="quote-breed-insights__title">
            Insights About {breedDisplay}
          </h3>
          <ul className="quote-breed-insights__list">
            {aboutBullets.slice(0, 2).map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}
      {showConsiderations && (
        <section className="quote-breed-insights__section" aria-labelledby="considerations-heading">
          <h3 id="considerations-heading" className="quote-breed-insights__title">
            Common Health Considerations
          </h3>
          <ul className="quote-breed-insights__list">
            {considerationBullets.slice(0, 3).map((b: string, i: number) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}
      <p className="quote-breed-insights__disclaimer">
        General breed trends. Not medical advice. Every pet is unique. This information is not used to determine pricing.
      </p>
      <hr className="quote-breed-insights__divider" aria-hidden />
    </div>
  )
}
