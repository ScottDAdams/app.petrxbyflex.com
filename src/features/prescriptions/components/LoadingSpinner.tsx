import React from "react"
import "./prescriptions.css"

const LoadingSpinner: React.FC = () => (
  <div
    className="prescriptions-page__loader"
    style={{
      border: "4px solid #f3f3f3",
      borderTop: "4px solid #007bff",
      borderRadius: "50%",
      width: "24px",
      height: "24px",
      margin: "0 auto",
    }}
  />
)

export default LoadingSpinner
