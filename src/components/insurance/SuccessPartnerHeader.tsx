import { HealthyPawsLogo } from "../HealthyPawsLogo"

export function SuccessPartnerHeader() {
  return (
    <div className="success-partner-header">
      <img
        src="/assets/petrxbyflex-logo.svg"
        alt="PetRx by Flex"
        className="success-partner-header__petrx-logo"
      />
      <span className="success-partner-header__separator">×</span>
      <HealthyPawsLogo size="lg" />
    </div>
  )
}
