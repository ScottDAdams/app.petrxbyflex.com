import * as React from "react"
import type { FlowStep } from "./flowSteps"

export type StepStatus = "completed" | "current" | "locked"

export type InsuranceProgressProps = {
  steps: FlowStep[]
  currentStepId: string
  completedStepIds: string[]
  enabledStepIds: string[]
  isCompact?: boolean
  onStepClick: (stepId: string) => void
}

export function InsuranceProgress({
  steps,
  currentStepId,
  completedStepIds,
  enabledStepIds,
  isCompact = false,
  onStepClick,
}: InsuranceProgressProps) {
  if (isCompact) {
    const currentIdx = steps.findIndex((s) => s.id === currentStepId)
    const idx = currentIdx >= 0 ? currentIdx : 0
    const currentStep = steps[idx]
    const pct = steps.length > 0 ? ((idx + 1) / steps.length) * 100 : 0

    const s: Record<string, React.CSSProperties> = {
      container: { marginBottom: 20, width: "100%", minWidth: 0, overflow: "hidden" },
      header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
      stepLabel: { fontSize: 15, fontWeight: 600, color: "var(--color-brand)" },
      stepCount: { fontSize: 13, color: "#666" },
      barBg: { height: 6, background: "#e0e0e0", borderRadius: 3, overflow: "hidden" },
      barFill: { height: "100%", background: "var(--color-brand)", borderRadius: 3, transition: "width 0.2s", width: `${pct}%` },
    }

    return (
      <div style={s.container}>
        <div style={s.header}>
          <span style={s.stepLabel}>{currentStep?.label ?? "Step"}</span>
          <span style={s.stepCount}>
            Step {idx + 1} of {steps.length}
          </span>
        </div>
        <div style={s.barBg}>
          <div style={s.barFill} />
        </div>
      </div>
    )
  }

  const getStatus = (step: FlowStep): StepStatus => {
    if (completedStepIds.includes(step.id)) return "completed"
    if (step.id === currentStepId) return "current"
    return "locked"
  }

  return (
    <div style={styles.container}>
      {steps.map((step, idx) => {
        const status = getStatus(step)
        const isEnabled = enabledStepIds.includes(step.id)
        const isClickable = isEnabled && (status === "completed" || status === "current")
        const isLast = idx === steps.length - 1

        return (
          <React.Fragment key={step.id}>
            <button
              type="button"
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              style={{
                ...styles.step,
                ...(status === "completed" ? styles.stepCompleted : {}),
                ...(status === "current" ? styles.stepCurrent : {}),
                ...(status === "locked" ? styles.stepLocked : {}),
              }}
              aria-current={status === "current" ? "step" : undefined}
            >
              <span style={styles.stepNumber}>{status === "completed" ? "✓" : idx + 1}</span>
              <span style={styles.stepLabel}>{step.label}</span>
            </button>
            {!isLast && (
              <div
                style={{
                  ...styles.connector,
                  ...(completedStepIds.includes(step.id) ? styles.connectorCompleted : {}),
                }}
              />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 0,
    marginBottom: 24,
  },
  step: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    border: "1px solid #e0e0e0",
    borderRadius: 8,
    background: "#fff",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 14,
  },
  stepCompleted: {
    borderColor: "var(--color-brand)",
    background: "var(--color-brand-light)",
    color: "var(--color-brand)",
  },
  stepCurrent: {
    borderColor: "var(--color-brand)",
    background: "var(--color-brand)",
    color: "#fff",
    fontWeight: 600,
  },
  stepLocked: {
    opacity: 0.6,
    cursor: "not-allowed",
    background: "#f5f5f5",
  },
  stepNumber: {
    width: 24,
    height: 24,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    fontSize: 12,
    fontWeight: 600,
  },
  stepLabel: {
    whiteSpace: "nowrap",
  },
  connector: {
    width: 24,
    height: 2,
    background: "#e0e0e0",
    flexShrink: 0,
  },
  connectorCompleted: {
    background: "var(--color-brand)",
  },
}
