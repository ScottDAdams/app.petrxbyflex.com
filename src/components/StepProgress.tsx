// src/components/StepProgress.tsx
type Step = { key: string; label: string }

function cn(...xs: Array<string | false | undefined | null>) {
  return xs.filter(Boolean).join(" ")
}

export function StepProgress({
  steps,
  currentKey,
  onStepClick,
}: {
  steps: Step[]
  currentKey: string
  onStepClick?: (stepKey: string) => void
}) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.key === currentKey)
  )

  const currentLabel = steps[currentIndex]?.label ?? "Progress"

  return (
    <div className="stepper">
      {/* Mobile */}
      <div className="stepper__mobile">
        <div className="stepper__mobileRow">
          <div className="stepper__mobileTitle">
            Step {currentIndex + 1} of {steps.length}
          </div>
          <div className="stepper__mobileLabel">{currentLabel}</div>
        </div>
        <div className="stepper__bar">
          <div
            className="stepper__barFill"
            style={{
              width: `${((currentIndex + 1) / steps.length) * 100}%`,
            }}
          />
        </div>
      </div>

      {/* Desktop */}
      <ol className="stepper__desktop" aria-label="Progress">
        {steps.map((s, idx) => {
          const state =
            idx < currentIndex ? "complete" : idx === currentIndex ? "current" : "upcoming"
          const isLast = idx === steps.length - 1

          return (
            <li key={s.key} className="stepper__item">
              <div className="stepper__nodeWrap">
                <div
                  className={cn(
                    "stepper__node",
                    state === "complete" && "is-complete",
                    state === "current" && "is-current",
                    state === "upcoming" && "is-upcoming",
                    onStepClick && (state === "complete" || state === "current") && "stepper__node--clickable"
                  )}
                  aria-current={state === "current" ? "step" : undefined}
                  onClick={onStepClick && (state === "complete" || state === "current") ? () => onStepClick(s.key) : undefined}
                  role={onStepClick && (state === "complete" || state === "current") ? "button" : undefined}
                  tabIndex={onStepClick && (state === "complete" || state === "current") ? 0 : undefined}
                  style={onStepClick && (state === "complete" || state === "current") ? { cursor: "pointer" } : undefined}
                >
                  {state === "complete" ? (
                    <svg
                      className="stepper__check"
                      viewBox="0 0 20 20"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M16.25 5.75L8.5 13.5L3.75 8.75"
                        stroke="currentColor"
                        strokeWidth="2.25"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <span className="stepper__num">{idx + 1}</span>
                  )}
                </div>

                {!isLast && (
                  <div className="stepper__line" aria-hidden="true">
                    <div
                      className={cn(
                        "stepper__lineFill",
                        idx < currentIndex && "is-filled"
                      )}
                    />
                  </div>
                )}
              </div>

              <div
                className={cn(
                  "stepper__label",
                  state === "current" && "is-current",
                  state === "upcoming" && "is-upcoming"
                )}
              >
                {s.label}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
