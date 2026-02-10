import { HealthyPawsLogo } from "./HealthyPawsLogo"

export type CoBrandHeaderProps = {
  variant?: "subtle" | "partner"
}

export function CoBrandHeader({ variant = "subtle" }: CoBrandHeaderProps) {
  if (variant === "partner") {
    return (
      <div className="co-brand-header co-brand-header--partner">
        <div className="co-brand-header__partner-strip">
          <span className="co-brand-header__petrx">PetRx</span>
          <span className="co-brand-header__separator">×</span>
          <HealthyPawsLogo size="sm" />
        </div>
      </div>
    )
  }

  return (
    <div className="co-brand-header">
      <div className="co-brand-header__subtle">
        <span className="co-brand-header__label">Insurance coverage provided by</span>
        <HealthyPawsLogo size="sm" />
      </div>
    </div>
  )
}
