import React, { useState, useEffect, useCallback, useRef } from "react"
import { useSearchParams, Link } from "react-router-dom"
import { API_BASE } from "../../../api"
import { PrescriptionLoadingOverlay } from "../components/PrescriptionLoadingOverlay"
import { ResendCardCallout } from "../components/ResendCardCallout"
import "../components/prescriptions.css"

interface PriceEntry {
  pharmacyName: string
  npi?: string
  price: string
  address: string
  retail?: string | null
  savings?: string | null
}

interface Quantity {
  value: number
  unit: string
}

interface DrugVariantOption {
  name: string
  type?: string
}

interface RestructuredBackendResponse {
  prices: PriceEntry[]
  displayInfo: {
    displayDrug: { name: string; type: string }
    displayForm: string
    displayStrength: string
    displayQuantity: string
  }
  relatedInfo: {
    relatedDrugs: DrugVariantOption[]
    relatedForms: string[]
    relatedStrengths: string[]
    relatedQuantities: { value: number; unit: string }[]
  }
  matchedNDC?: string
  originalRequestData: {
    drugName: string
    zipCode: string
    form: string
    strength: string
    quantity: string
    ndc?: string
  }
}

const logoMap: Record<string, string> = {
  cvs: "/images/logos/cvs_logo.svg",
  walgreens: "/images/logos/walgreens_logo.svg",
  walgreen: "/images/logos/walgreens_logo.svg",
  walmart: "/images/logos/walmart_logo.svg",
  kroger: "/images/logos/kroger_logo.svg",
  safeway: "/images/logos/safeway_logo.svg",
  giant: "/images/logos/giant_logo.svg",
  "harris teeter": "/images/logos/harristeeter_logo.svg",
  "fred meyer": "/images/logos/fredmeyer_logo.svg",
  target: "/images/logos/target_logo.svg",
  riteaid: "/images/logos/riteaid_logo.svg",
  "rite aid": "/images/logos/riteaid_logo.svg",
  costco: "/images/logos/costco_logo.svg",
}

function getPharmacyLogo(name: string | undefined | null): string {
  if (!name) return "/images/logos/blank.svg"
  const lower = name.toLowerCase()
  for (const key of Object.keys(logoMap)) {
    if (lower.includes(key)) return logoMap[key]
  }
  return "/images/logos/blank.svg"
}

function LogoImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div
      style={{
        width: "60px",
        height: "60px",
        minWidth: "60px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        marginRight: "0.5rem",
      }}
    >
      <img src={src} alt={alt} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
    </div>
  )
}

function parseNumericValue(value: string): number {
  const match = value.match(/(\d+(\.\d+)?)/)
  return match ? parseFloat(match[1]) : 0
}

const cleanApiBase = (API_BASE || "").replace(/\/+$/, "")

export default function DrugPricePage() {
  const [searchParams] = useSearchParams()
  const initialSource = searchParams.get("source") || "pet"
  const initialDrugNameParam = searchParams.get("name") || ""
  const initialZipCodeParam = searchParams.get("zip") || ""
  const initialNdcParam = searchParams.get("ndc") || ""

  const [currentDrugName, setCurrentDrugName] = useState(initialDrugNameParam)
  const [currentForm, setCurrentForm] = useState("")
  const [currentStrength, setCurrentStrength] = useState("")
  const [currentQuantity, setCurrentQuantity] = useState<number | string>("")
  const [customQuantity, setCustomQuantity] = useState("")

  const [displayDrugName, setDisplayDrugName] = useState(initialDrugNameParam)
  const [displayDrugType, setDisplayDrugType] = useState("")
  const [displayFormText, setDisplayFormText] = useState("")
  const [displayStrengthText, setDisplayStrengthText] = useState("")
  const [displayQuantityText, setDisplayQuantityText] = useState("")

  const [relatedDrugs, setRelatedDrugs] = useState<DrugVariantOption[]>([])
  const [availableForms, setAvailableForms] = useState<string[]>([])
  const [availableStrengths, setAvailableStrengths] = useState<string[]>([])
  const [availableQuantities, setAvailableQuantities] = useState<Quantity[]>([])

  const [prices, setPrices] = useState<PriceEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [openDetailsKeys, setOpenDetailsKeys] = useState<Set<string>>(new Set())
  const [pricingErrorMessage, setPricingErrorMessage] = useState<string | null>(null)
  /** Last prices array we applied default-open to; avoids re-running and shaking */
  const lastPricesRef = useRef<PriceEntry[]>([])
  /** Params last used for a successful fetch; used to enable/disable Update Prices */
  const [lastFetchedParams, setLastFetchedParams] = useState<{
    drugName: string
    form: string
    strength: string
    quantity: string
  } | null>(null)

  const fetchPricingData = useCallback(
    async (
      drugNameParam: string,
      zipCodeParam: string,
      formParam: string,
      strengthParam: string,
      selectedQuantityValue: number | string,
      customQuantityValue: string,
      passedNdc: string = "",
      initialLoad: boolean = false
    ) => {
      setPricingErrorMessage(null)
      if (!drugNameParam || !zipCodeParam) {
        setPrices([])
        setIsLoading(false)
        return
      }
      setIsLoading(true)
      const quantityToSend =
        selectedQuantityValue === "custom" && customQuantityValue ? customQuantityValue : String(selectedQuantityValue)
      const payload = {
        drugName: drugNameParam,
        zipCode: zipCodeParam,
        form: formParam,
        strength: strengthParam,
        quantity: quantityToSend,
        ndc: passedNdc,
      }
      try {
        const res = await fetch(`${cleanApiBase}/api/unarx-dash-price`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        const result: RestructuredBackendResponse = await res.json()
        if (res.ok && result?.prices?.length > 0) {
          setPrices(result.prices)
          setDisplayDrugName(result.displayInfo.displayDrug.name)
          setDisplayDrugType(result.displayInfo.displayDrug.type)
          setDisplayFormText(result.displayInfo.displayForm)
          setDisplayStrengthText(result.displayInfo.displayStrength)
          setDisplayQuantityText(result.displayInfo.displayQuantity)
          setLastFetchedParams({
            drugName: drugNameParam,
            form: formParam,
            strength: strengthParam,
            quantity: quantityToSend,
          })
          setRelatedDrugs(result.relatedInfo.relatedDrugs || [])
          let forms = result.relatedInfo.relatedForms || []
          if (result.displayInfo.displayForm && !forms.includes(result.displayInfo.displayForm)) {
            forms = [result.displayInfo.displayForm, ...forms]
          }
          setAvailableForms(forms)
          let strengths = result.relatedInfo.relatedStrengths || []
          if (result.displayInfo.displayStrength && !strengths.includes(result.displayInfo.displayStrength)) {
            strengths = [result.displayInfo.displayStrength, ...strengths]
          }
          setAvailableStrengths(strengths)
          let quantities = result.relatedInfo.relatedQuantities || []
          const displayQtyValue = parseNumericValue(result.displayInfo.displayQuantity)
          const displayQtyUnitMatch = result.displayInfo.displayQuantity.match(/[A-Z]+/i)
          const displayQtyUnit = displayQtyUnitMatch ? displayQtyUnitMatch[0] : "units"
          const displayQuantityAsOption = { value: displayQtyValue, unit: displayQtyUnit.toLowerCase() }
          if (
            !quantities.some(
              (q) => q.value === displayQtyValue && q.unit.toLowerCase() === displayQtyUnit.toLowerCase()
            )
          ) {
            quantities = [displayQuantityAsOption, ...quantities]
          }
          setAvailableQuantities(quantities)
          if (initialLoad) {
            setCurrentDrugName(result.displayInfo.displayDrug.name)
            setCurrentForm(result.displayInfo.displayForm)
            setCurrentStrength(result.displayInfo.displayStrength)
            setCurrentQuantity(displayQtyValue)
            setCustomQuantity("")
          }
        } else {
          setPrices([])
          setDisplayDrugName(drugNameParam)
          setDisplayDrugType("")
          setDisplayFormText(formParam)
          setDisplayStrengthText(strengthParam)
          setDisplayQuantityText(String(selectedQuantityValue))
          setLastFetchedParams({
            drugName: drugNameParam,
            form: formParam,
            strength: strengthParam,
            quantity: quantityToSend,
          })
          setRelatedDrugs([])
          setAvailableForms([])
          setAvailableStrengths([])
          setAvailableQuantities([])
          if (!res.ok && res.status === 500) {
            setPricingErrorMessage(
              `We are currently updating pricing for "${drugNameParam}". Please visit your local pharmacy for current discount pricing.`
            )
          } else {
            setPricingErrorMessage(null)
          }
        }
      } catch (err: unknown) {
        console.error("Error fetching pricing or parsing response:", err)
        setPrices([])
        setDisplayDrugName(drugNameParam)
        setDisplayDrugType("")
        setDisplayFormText(formParam)
        setDisplayStrengthText(strengthParam)
        setDisplayQuantityText(String(selectedQuantityValue))
        setRelatedDrugs([])
        setAvailableForms([])
        setAvailableStrengths([])
        setAvailableQuantities([])
        setPricingErrorMessage(
          `Failed to load pricing for "${drugNameParam}". Please try again later or visit your local pharmacy.`
        )
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  useEffect(() => {
    if (initialDrugNameParam || initialNdcParam) {
      const initialNameForSearch = initialDrugNameParam || (initialNdcParam ? "Drug by NDC" : "")
      const initialQuantityForSearch = parseNumericValue(searchParams.get("quantity") || "30")
      fetchPricingData(
        initialNameForSearch,
        initialZipCodeParam,
        searchParams.get("form") || "",
        searchParams.get("strength") || "",
        initialQuantityForSearch,
        customQuantity,
        initialNdcParam,
        true
      )
    } else {
      setIsLoading(false)
    }
  }, [initialDrugNameParam, initialZipCodeParam, initialNdcParam, fetchPricingData, searchParams, customQuantity])

  const handleDrugNameChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentDrugName(e.target.value)
    setPricingErrorMessage(null)
  }

  const handleFormChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentForm(e.target.value)
    setPricingErrorMessage(null)
  }

  const handleStrengthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentStrength(e.target.value)
    setPricingErrorMessage(null)
  }

  const handleQuantityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newQuantity = e.target.value
    setPricingErrorMessage(null)
    if (newQuantity === "custom") {
      setCurrentQuantity("custom")
      setCustomQuantity("")
    } else {
      setCurrentQuantity(Number(newQuantity))
      setCustomQuantity("")
    }
  }

  const handleCustomQuantityBlur = () => {
    setPricingErrorMessage(null)
  }

  const handleUpdateClick = () => {
    setPricingErrorMessage(null)
    const quantityToUse =
      currentQuantity === "custom" ? (isNaN(Number(customQuantity)) ? 0 : Number(customQuantity)) : Number(currentQuantity)
    const customQtyVal = currentQuantity === "custom" ? customQuantity : ""
    fetchPricingData(
      currentDrugName,
      initialZipCodeParam,
      currentForm,
      currentStrength,
      quantityToUse,
      customQtyVal,
      initialNdcParam,
      false
    )
  }

  const sortedPrices = [...prices].sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
  const retail = sortedPrices[0]?.retail ? parseFloat(sortedPrices[0].retail) : null

  // When we get new results (new prices reference), open the first pharmacy (lowest price) once
  useEffect(() => {
    if (prices.length === 0) {
      lastPricesRef.current = []
      return
    }
    if (lastPricesRef.current === prices) return
    lastPricesRef.current = prices
    const grouped = Object.entries(
      sortedPrices.reduce(
        (acc, entry) => {
          const base = entry.pharmacyName.split("#")[0].trim()
          const key = `${base}__${entry.price}`
          if (!acc[key]) acc[key] = []
          acc[key].push(entry)
          return acc
        },
        {} as Record<string, PriceEntry[]>
      )
    )
    if (grouped.length > 0) {
      setOpenDetailsKeys(new Set([grouped[0][0]]))
    }
  }, [prices])

  const effectiveQuantity =
    currentQuantity === "custom" ? customQuantity : String(currentQuantity)
  const isDirty =
    lastFetchedParams != null &&
    (currentDrugName !== lastFetchedParams.drugName ||
      currentForm !== lastFetchedParams.form ||
      currentStrength !== lastFetchedParams.strength ||
      effectiveQuantity !== lastFetchedParams.quantity)

  const groupedEntries = Object.entries(
    sortedPrices.reduce(
      (acc, entry) => {
        const base = entry.pharmacyName.split("#")[0].trim()
        const key = `${base}__${entry.price}`
        if (!acc[key]) acc[key] = []
        acc[key].push(entry)
        return acc
      },
      {} as Record<string, PriceEntry[]>
    )
  )

  const newSearchUrl = `/prescriptions/drug-search?name=${encodeURIComponent(displayDrugName)}&zip=${initialZipCodeParam}`

  return (
    <div className="prescriptions-page">
      <h1 className="prescriptions-results__title">
        {displayDrugName.toUpperCase()}
        {displayDrugType && <span className="prescriptions-results__title-type"> {displayDrugType}</span>}
      </h1>
      {retail != null && (
        <div className="prescriptions-results__retail-banner">
          <strong>Average Retail Price</strong>
          <span style={{ fontSize: "1.2rem", fontWeight: "bold" }}>${retail.toFixed(2)}</span>
        </div>
      )}
      <p className="prescriptions-results__prices-for">
        Prices for: <strong>{displayFormText}, {displayStrengthText}, {displayQuantityText}</strong> near ZIP{" "}
        <strong>{initialZipCodeParam}</strong>
      </p>

      <ResendCardCallout />

      {displayDrugType === "(brand)" && (
        <div
          style={{
            backgroundColor: "#fff3cd",
            color: "#664d03",
            border: "1px solid #ffecb5",
            borderRadius: "0.25rem",
            padding: "0.75rem 1.25rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          For better pricing, under <strong>Drug Name</strong> select the generic version of this drug. The pharmacy
          will be happy to substitute a generic for any brand name prescription.
        </div>
      )}

      {pricingErrorMessage && (
        <div
          style={{
            backgroundColor: "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            borderRadius: "0.25rem",
            padding: "0.75rem 1.25rem",
            marginBottom: "1rem",
            fontSize: "0.9rem",
          }}
        >
          {pricingErrorMessage}
        </div>
      )}

      <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", margin: "1.5rem 0", alignItems: "flex-end" }}>
        {relatedDrugs.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <label className="prescriptions-results__label">Drug Name:</label>
            <select className="prescriptions-results__control" value={currentDrugName} onChange={handleDrugNameChange} disabled={isLoading}>
              {!relatedDrugs.some((d) => d.name.toLowerCase() === displayDrugName.toLowerCase()) &&
                displayDrugName && (
                  <option key={displayDrugName || "display-current"} value={displayDrugName}>
                    {displayDrugName} {displayDrugType}
                  </option>
                )}
              {relatedDrugs.map((drug, index) => (
                <option key={drug.name ? `${drug.name}-${index}` : `drug-${index}`} value={drug.name}>
                  {drug.name} {drug.type}
                </option>
              ))}
            </select>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <label className="prescriptions-results__label">Form:</label>
          <select className="prescriptions-results__control" value={currentForm} onChange={handleFormChange} disabled={isLoading}>
            {availableForms.map((form, i) => (
              <option key={form || `form-${i}`} value={form}>
                {form}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <label className="prescriptions-results__label">Strength:</label>
          <select className="prescriptions-results__control" value={currentStrength} onChange={handleStrengthChange} disabled={isLoading}>
            {availableStrengths.map((s, i) => (
              <option key={s || `strength-${i}`} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <label className="prescriptions-results__label">Quantity:</label>
          {currentQuantity === "custom" || availableQuantities.length === 0 ? (
            <input
              type="number"
              className="prescriptions-results__control"
              value={customQuantity}
              onChange={(e) => setCustomQuantity(e.target.value)}
              onBlur={handleCustomQuantityBlur}
              placeholder="Enter quantity"
              disabled={isLoading}
            />
          ) : (
            <select className="prescriptions-results__control" value={currentQuantity} onChange={handleQuantityChange} disabled={isLoading}>
              {availableQuantities.map((q) => (
                <option key={`${q.value}-${q.unit || "unknown"}`} value={q.value}>
                  {q.value} {q.unit?.toLowerCase() || "units"}
                </option>
              ))}
              <option value="custom">Custom Amount</option>
            </select>
          )}
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <button
            type="button"
            className="prescriptions-results__btn-primary"
            onClick={handleUpdateClick}
            disabled={isLoading || !isDirty}
          >
            Update Prices
          </button>
        </div>
        <div style={{ alignSelf: "flex-end" }}>
          <Link to={newSearchUrl} className="prescriptions-results__btn-new-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            New search
          </Link>
        </div>
      </div>

      {isLoading && <PrescriptionLoadingOverlay source={initialSource === "rx" ? "rx" : "pet"} />}

      {prices.length === 0 && !isLoading && (
        <div style={{ color: "#666", padding: "1.5rem 0", fontStyle: "italic", textAlign: "center" }}>
          No prices found for this combination. Try another selection.
        </div>
      )}

      {groupedEntries.map(([groupKey, entries], groupIndex) => {
        const parts = String(groupKey).split("__")
        const baseName = parts[0] ? String(parts[0]).split("#")[0].trim() : ""
        const price = parts[1] || "0.00"
        const logo = getPharmacyLogo(baseName)
        const entryRetail = entries[0].retail ? parseFloat(entries[0].retail) : null
        const priceFloat = parseFloat(price)
        const savings =
          entryRetail && entryRetail > priceFloat
            ? Math.round(((entryRetail - priceFloat) / entryRetail) * 100)
            : null
        const isOpen = openDetailsKeys.has(groupKey)
        const stableKey = groupKey || `pharmacy-${baseName || "unknown"}-${price}-${groupIndex}`
        const toggleThis = () => {
          setOpenDetailsKeys((prev) => {
            const updated = new Set(prev)
            if (updated.has(groupKey)) updated.delete(groupKey)
            else updated.add(groupKey)
            return updated
          })
        }
        return (
          <details
            key={stableKey}
            open={isOpen}
            style={{
              border: "1px solid #ccc",
              borderRadius: "6px",
              marginBottom: "1rem",
              backgroundColor: "#fefefe",
              padding: "0.75rem",
            }}
          >
            <summary
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.preventDefault()
                toggleThis()
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  toggleThis()
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <LogoImage src={logo} alt={baseName} />
                <strong>{baseName}</strong>
                <span style={{ fontSize: "0.85rem" }}>
                  ({entries.length} location{entries.length > 1 ? "s" : ""} found)
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{ fontWeight: "bold", color: "green", fontSize: "1.1rem" }}>${price}</div>
                  {savings != null && (
                    <div style={{ color: "#d9534f", fontSize: "0.85rem", fontWeight: 500 }}>Save {savings}%</div>
                  )}
                </div>
                <span
                  style={{
                    transition: "transform 0.2s",
                    transform: isOpen ? "rotate(90deg)" : "rotate(0deg)",
                    display: "inline-block",
                  }}
                >
                  ▶
                </span>
              </div>
            </summary>
            <div style={{ marginTop: "0.75rem", paddingLeft: "2rem" }}>
              {entries.map((entry, entryIndex) => (
                <div
                  key={`${baseName}-${entry.price}-${entry.address || "addr"}-${entry.npi ?? `idx-${entryIndex}`}`}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    borderBottom: "1px solid #eee",
                    padding: "0.5rem 0",
                  }}
                >
                  <div>
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(entry.address)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: "0.9rem", color: "#007bff" }}
                    >
                      📍 {entry.address}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </details>
        )
      })}
    </div>
  )
}
