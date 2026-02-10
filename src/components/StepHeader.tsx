export type StepHeaderProps = {
  currentStep: number
  totalSteps: number
  stepLabel: string
}

export function StepHeader({ currentStep, totalSteps, stepLabel }: StepHeaderProps) {
  return (
    <div className="step-header">
      <span className="step-header__badge">Step {currentStep} of {totalSteps}</span>
      <span className="step-header__label">{stepLabel}</span>
    </div>
  )
}
