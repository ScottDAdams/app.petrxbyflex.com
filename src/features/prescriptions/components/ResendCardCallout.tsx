import { useState } from "react"
import { ResendCardModal } from "./ResendCardModal"

export function ResendCardCallout() {
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <>
      <div
        className="prescriptions-resend-callout"
        style={{
          marginTop: "16px",
          padding: "14px 16px",
          background: "var(--petrx-surface, #fff)",
          border: "1px solid var(--petrx-border, #e7eef6)",
          borderRadius: "var(--radius-sm, 6px)",
          fontSize: "0.9375rem",
        }}
      >
        <p style={{ margin: "0 0 10px 0", fontWeight: 600, color: "#111827" }}>
          Don't have a PetRx card or need it again?
        </p>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          style={{
            padding: "8px 16px",
            fontSize: "0.875rem",
            fontWeight: 500,
            border: "none",
            borderRadius: "var(--radius-sm, 6px)",
            background: "var(--color-brand, #2c5aa0)",
            color: "#fff",
            cursor: "pointer",
          }}
        >
          Email me my card
        </button>
      </div>
      {modalOpen && <ResendCardModal onClose={() => setModalOpen(false)} />}
    </>
  )
}
