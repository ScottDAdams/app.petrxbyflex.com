import { HealthyPawsLogo } from "../HealthyPawsLogo"

export function PartnerBar() {
  return (
    <div className="partner-bar partner-bar--trust">
      <div className="partner-bar__trust-content">
        <div className="partner-bar__trust-text">
          <span className="partner-bar__label">Brought to you by our partner</span>
          <span className="partner-bar__trust-line">Trusted by pet parents nationwide</span>
        </div>
        <HealthyPawsLogo size="lg" />
      </div>
    </div>
  )
}
