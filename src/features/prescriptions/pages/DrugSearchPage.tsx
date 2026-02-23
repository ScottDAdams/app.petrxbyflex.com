import { useState, ChangeEvent, useEffect, useRef } from "react"
import { useNavigate, useLocation } from "react-router-dom"
import { API_BASE } from "../../../api"
import LoadingSpinner from "../components/LoadingSpinner"
import { ResendCardCallout } from "../components/ResendCardCallout"
import { useDrugSuggestions, type DrugSuggestion } from "../hooks/useDrugSuggestions"
import "../components/prescriptions.css"

const cleanApiBase = (API_BASE || "").replace(/\/+$/, "")

const PHARMACY_LOGOS = [
  { name: "CVS", src: "/images/logos/cvs_logo.svg" },
  { name: "Walmart", src: "/images/logos/walmart_logo.svg" },
  { name: "Walgreens", src: "/images/logos/walgreens_logo.svg" },
  { name: "Kroger", src: "/images/logos/kroger_logo.svg" },
  { name: "Rite Aid", src: "/images/logos/riteaid_logo.svg" },
  { name: "Safeway", src: "/images/logos/safeway_logo.svg" },
  { name: "Target", src: "/images/logos/target_logo.svg" },
]

export default function DrugSearchPage() {
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const source = searchParams.get("source") || "pet"
  const initialName = searchParams.get("name") || ""
  const initialZip = searchParams.get("zip") || ""

  const [drugNameQuery, setDrugNameQuery] = useState(initialName)
  const [zipCode, setZipCode] = useState(initialZip)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)

  const { suggestions, isLoading: isSuggestionsLoading, error: apiError, fetchSuggestions, clearSuggestions } =
    useDrugSuggestions(cleanApiBase)
  const error = validationError ?? apiError

  const navigate = useNavigate()
  const suggestionsBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDrugNameQuery((prev) => (initialName !== prev ? initialName : prev))
    setZipCode((prev) => (initialZip !== prev ? initialZip : prev))
  }, [initialName, initialZip])

  const handleDrugNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setValidationError(null)
    const term = e.target.value
    setDrugNameQuery(term)
    const trimmed = term.trim()
    if (trimmed.length >= 3) {
      fetchSuggestions(term)
      setShowSuggestions(true)
    } else {
      clearSuggestions()
      setShowSuggestions(false)
    }
  }

  const handleSuggestionClick = (suggestion: DrugSuggestion) => {
    setDrugNameQuery(suggestion.label)
    clearSuggestions()
    setShowSuggestions(false)
  }

  const handleMainSearch = () => {
    const zipTrimmed = zipCode.trim()
    if (!drugNameQuery.trim()) return setValidationError("Please enter or select a drug name.")
    if (!/^\d{5}$/.test(zipTrimmed)) return setValidationError("Please enter a valid 5-digit ZIP code.")
    setValidationError(null)
    setIsSearching(true)
    navigate(
      `/prescriptions/drug-price?name=${encodeURIComponent(drugNameQuery.trim())}&zip=${zipTrimmed}&source=${source}`
    )
  }

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (suggestionsBoxRef.current && !suggestionsBoxRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  return (
    <div className="prescriptions-page">
      <section className="prescriptions-search__hero">
        <h1 className="prescriptions-search__hero-title">Rx Price Lookup</h1>
        <p className="prescriptions-search__hero-subtitle">
          Find the best prescription prices at pharmacies near you.
        </p>
        <p className="prescriptions-search__hero-note">No login required.</p>
      </section>

      <div className="prescriptions-search__card">
        <div className="prescriptions-search__card-head">
          <div className="prescriptions-search__card-icon" aria-hidden>
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <h2 className="prescriptions-search__card-title">Search by medication and ZIP</h2>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ position: "relative" }} ref={suggestionsBoxRef}>
            <label htmlFor="drug-name" style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#374151", marginBottom: "4px" }}>
              Medication Name
            </label>
            <div style={{ position: "relative" }}>
              <input
                id="drug-name"
                type="text"
                value={drugNameQuery}
                onChange={handleDrugNameChange}
                onFocus={() => drugNameQuery.trim().length >= 3 && setShowSuggestions(true)}
                placeholder="e.g., Lisinopril"
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  fontSize: "1rem",
                  border: "1px solid var(--petrx-border, #e7eef6)",
                  borderRadius: "var(--radius-sm, 6px)",
                  outline: "none",
                }}
              />
              <div style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
                <svg width="18" height="18" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            {showSuggestions && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  marginTop: "4px",
                  background: "#fff",
                  border: "1px solid var(--petrx-border, #e7eef6)",
                  borderRadius: "var(--radius-sm, 6px)",
                  boxShadow: "var(--petrx-shadow-soft, 0 6px 18px rgba(16, 24, 40, 0.08))",
                  zIndex: 50,
                  maxHeight: "240px",
                  overflowY: "auto",
                }}
              >
                {isSuggestionsLoading && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "12px" }}>
                    <LoadingSpinner />
                    <span style={{ marginLeft: "8px", fontSize: "0.875rem", color: "#6b7280" }}>Searching...</span>
                  </div>
                )}
                {!isSuggestionsLoading && suggestions.length === 0 && drugNameQuery.length >= 3 && (
                  <div style={{ padding: "12px", fontSize: "0.875rem", color: "#6b7280", textAlign: "center" }}>
                    No medications found. Try a different search term.
                  </div>
                )}
                {!isSuggestionsLoading &&
                  suggestions.map((suggestion, index) => (
                    <div
                      key={suggestion.value ? `${suggestion.value}-${index}` : `suggestion-${index}`}
                      onClick={() => handleSuggestionClick(suggestion)}
                      style={{
                        padding: "10px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid #f3f4f6",
                        fontSize: "0.875rem",
                      }}
                      onKeyDown={(e) => e.key === "Enter" && handleSuggestionClick(suggestion)}
                      role="button"
                      tabIndex={0}
                    >
                      <span style={{ fontWeight: 500, color: "#111827" }}>{suggestion.label}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="zip-code" style={{ display: "block", fontSize: "0.875rem", fontWeight: 500, color: "#374151", marginBottom: "4px" }}>
              ZIP Code
            </label>
            <input
              id="zip-code"
              type="text"
              value={zipCode}
              onChange={(e) => {
                setValidationError(null)
                setZipCode(e.target.value)
              }}
              placeholder="5-digit ZIP"
              maxLength={5}
              style={{
                width: "100%",
                padding: "10px 12px",
                fontSize: "1rem",
                border: "1px solid var(--petrx-border, #e7eef6)",
                borderRadius: "var(--radius-sm, 6px)",
                outline: "none",
              }}
            />
          </div>

          <button
            type="button"
            className="prescriptions-search__btn-find"
            onClick={handleMainSearch}
            disabled={isSearching || !drugNameQuery.trim() || !zipCode.trim()}
            style={{
              width: "100%",
              marginTop: "4px",
            }}
          >
            {isSearching ? (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <LoadingSpinner />
                <span style={{ marginLeft: "8px" }}>Searching...</span>
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" style={{ marginRight: "8px" }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Find Prices
              </span>
            )}
          </button>
        </div>
      </div>

      <ResendCardCallout />

      {error && !showSuggestions && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "var(--radius-sm, 6px)", padding: "12px", textAlign: "center", marginBottom: "16px" }}>
          <p style={{ fontSize: "0.875rem", color: "#b91c1c", fontWeight: 500, margin: 0 }}>{error}</p>
        </div>
      )}

      <div className="prescriptions-search__logos" aria-label="Trusted at pharmacies nationwide">
        {PHARMACY_LOGOS.map((logo) => (
          <img
            key={logo.name}
            src={logo.src}
            alt={logo.name}
            className="prescriptions-search__logo-img"
            width={80}
            height={28}
          />
        ))}
      </div>

      <div className="prescriptions-search__benefits">
        <div className="prescriptions-search__benefit">
          <h3 className="prescriptions-search__benefit-title">Best Prices</h3>
          <p className="prescriptions-search__benefit-desc">Compare prices across multiple pharmacies</p>
        </div>
        <div className="prescriptions-search__benefit">
          <h3 className="prescriptions-search__benefit-title">Local Pharmacies</h3>
          <p className="prescriptions-search__benefit-desc">Find pharmacies near your location</p>
        </div>
        <div className="prescriptions-search__benefit">
          <h3 className="prescriptions-search__benefit-title">Instant Results</h3>
          <p className="prescriptions-search__benefit-desc">Get pricing information immediately</p>
        </div>
      </div>
    </div>
  )
}
