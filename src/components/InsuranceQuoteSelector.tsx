import * as React from "react"

export type ProcessedPlans = {
  allReimbursements: string[]
  allDeductibles: string[]
  defaultPolicy: Record<string, unknown> | null
  allPolicies: Record<string, unknown>[]
}

export type InsuranceQuoteSelectorProps = {
  processedPlans: ProcessedPlans
  selectedReimbursement: string
  selectedDeductible: string
  onSelectionChange: (reimbursement: string, deductible: string) => void
  petName?: string
  disabled?: boolean
}

export function InsuranceQuoteSelector({
  processedPlans,
  selectedReimbursement,
  selectedDeductible,
  onSelectionChange,
  petName = "your pet",
  disabled = false,
}: InsuranceQuoteSelectorProps) {
  const { allPolicies, allReimbursements, allDeductibles } = processedPlans
  const displayName = (petName && petName.trim().length > 0) ? petName.trim() : "Your Pet"

  const allowedDeductibles = React.useMemo(() => {
    const set = new Set<string>()
    const r = selectedReimbursement || "70"
    for (const p of allPolicies) {
      const rr = Math.round(((p.reimbursement as number) || 0) * 100).toString()
      if (rr === r) set.add(String(p.deductible))
    }
    return allDeductibles.filter((d) => set.has(d))
  }, [allPolicies, allDeductibles, selectedReimbursement])

  const currentPricing = React.useMemo(() => {
    const r = selectedReimbursement || "70"
    const d = selectedDeductible || "500"
    const match = allPolicies.find(
      (p) =>
        Math.round(((p.reimbursement as number) || 0) * 100).toString() === r &&
        p.deductible?.toString() === d
    )
    return (match?.monthly_premium as string) || "0.00"
  }, [allPolicies, selectedReimbursement, selectedDeductible])

  const planType = React.useMemo(() => {
    // Find the selected policy to get isHighDeductible
    const selectedPolicy = allPolicies.find(
      (p) =>
        Math.round(((p.reimbursement as number) || 0) * 100).toString() === selectedReimbursement &&
        String(p.deductible) === selectedDeductible
    )
    const isHighDeductible = (selectedPolicy?.isHighDeductible as boolean) ?? false
    if (!isHighDeductible) {
      return { type: "signature" as const, name: "Most Popular", description: "Coverage for accidents and illnesses, designed for life's daily adventures." }
    }
    return { type: "value" as const, name: "Value Plan", description: "Signature coverage at a lower monthly cost. Higher deductibles mean lower monthly premiums." }
  }, [selectedDeductible, selectedReimbursement, allPolicies])

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>
        {displayName}&apos;s Custom Quote from Healthy Paws Pet Insurance
      </h2>
      <p style={styles.subtitle}>
        Protect your pet from unexpected vet bills while saving on prescriptions
      </p>
      <div style={styles.card}>
        <div style={{ ...styles.planBadge, ...(planType.type === "value" ? styles.planBadgeValue : {}) }}>
          {planType.name}
        </div>
        <div style={styles.cardContent}>
          <div style={styles.priceColumn}>
            <div style={styles.priceLabel}>Starting at just</div>
            <div style={styles.priceAmount}>
              ${currentPricing}
              <span style={styles.pricePeriod}>/month</span>
            </div>
          </div>
          <div style={styles.detailsColumn}>
            <div style={styles.featuresList}>
              <div style={styles.featureItem}>
                <span style={styles.featureValue}>{selectedReimbursement || "70"}%</span>
                <span style={styles.featureLabel}>Reimbursement</span>
              </div>
              <div style={{ ...styles.featureItem, borderBottom: "none" }}>
                <span style={styles.featureValue}>${selectedDeductible || "500"}</span>
                <span style={styles.featureLabel}>Annual Deductible</span>
              </div>
            </div>
            <p style={styles.description}>{planType.description}</p>
          </div>
        </div>
        <div style={styles.optionsSection}>
          <h4 style={styles.optionLabel}>Reimbursement</h4>
          <div style={styles.optionGrid}>
            {allReimbursements.map((r) => (
              <button
                key={r}
                type="button"
                disabled={disabled}
                onClick={() => onSelectionChange(r, selectedDeductible)}
                style={{ ...styles.optionBtn, ...(selectedReimbursement === r ? styles.optionBtnActive : {}) }}
              >
                {r}%
              </button>
            ))}
          </div>
          <h4 style={styles.optionLabel}>Annual Deductible</h4>
          <div style={styles.optionGrid}>
            {allowedDeductibles.map((d) => (
              <button
                key={d}
                type="button"
                disabled={disabled}
                onClick={() => onSelectionChange(selectedReimbursement, d)}
                style={{ ...styles.optionBtn, ...(selectedDeductible === d ? styles.optionBtnActive : {}) }}
              >
                ${d}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", width: "100%", fontFamily: "inherit", color: "#333" },
  title: { fontSize: 18, margin: "0 0 12px 0", color: "var(--color-brand)", fontWeight: 600 },
  subtitle: { color: "#666", margin: "0 0 15px 0", fontSize: 14 },
  card: {
    background: "#fff",
    borderRadius: 12,
    padding: "25px 20px 20px 20px",
    marginBottom: 10,
    border: "1px solid #e0e0e0",
    boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
    position: "relative",
  },
  planBadge: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: "6px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    background: "#eaf2ff",
    color: "var(--color-brand)",
    border: "1px solid var(--color-brand)",
    zIndex: 2,
  },
  planBadgeValue: { background: "#fff", color: "var(--color-brand)", border: "1px solid var(--color-brand)" },
  cardContent: { display: "flex", gap: 24, alignItems: "flex-start" },
  priceColumn: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  priceLabel: { fontSize: "0.9em", color: "#7f8c8d", marginBottom: 8 },
  priceAmount: { fontSize: "2.8em", fontWeight: 700, color: "var(--color-brand)", lineHeight: 1, whiteSpace: "nowrap" },
  pricePeriod: { fontSize: "0.35em", color: "#7f8c8d", marginLeft: 2 },
  detailsColumn: { flex: 1.2, minWidth: 0, paddingRight: 10 },
  featuresList: { marginBottom: 16 },
  featureItem: { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f0f0f0" },
  featureValue: { fontWeight: 700, fontSize: "1.1em", color: "#2c3e50", minWidth: 50 },
  featureLabel: { color: "#5d6d7e", fontSize: "0.9em", whiteSpace: "nowrap" },
  description: { color: "#555", fontSize: "0.9em", lineHeight: 1.5, margin: 0 },
  optionsSection: { marginTop: 20, paddingTop: 16, borderTop: "1px solid #f0f0f0" },
  optionLabel: { fontSize: 14, fontWeight: 600, color: "#2c3e50", margin: "0 0 8px 0" },
  optionGrid: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  optionBtn: {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #D1D5DB",
    background: "#fff",
    color: "#374151",
    fontSize: 14,
    fontWeight: 500,
    cursor: "pointer",
  },
  optionBtnActive: { borderColor: "var(--color-brand)", background: "var(--color-brand-light)", color: "var(--color-brand)" },
}
