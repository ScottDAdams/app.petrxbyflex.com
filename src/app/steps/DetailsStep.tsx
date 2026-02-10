import * as React from "react"
import { PartnerBar } from "../../components/insurance/PartnerBar"
import { PrimaryActionButton } from "../../components/ui/PrimaryActionButton"

const US_STATES = [
  { label: "Select a state", value: "" },
  { label: "Alabama", value: "AL" },
  { label: "Alaska", value: "AK" },
  { label: "Arizona", value: "AZ" },
  { label: "Arkansas", value: "AR" },
  { label: "California", value: "CA" },
  { label: "Colorado", value: "CO" },
  { label: "Connecticut", value: "CT" },
  { label: "Delaware", value: "DE" },
  { label: "District of Columbia", value: "DC" },
  { label: "Florida", value: "FL" },
  { label: "Georgia", value: "GA" },
  { label: "Hawaii", value: "HI" },
  { label: "Idaho", value: "ID" },
  { label: "Illinois", value: "IL" },
  { label: "Indiana", value: "IN" },
  { label: "Iowa", value: "IA" },
  { label: "Kansas", value: "KS" },
  { label: "Kentucky", value: "KY" },
  { label: "Louisiana", value: "LA" },
  { label: "Maine", value: "ME" },
  { label: "Maryland", value: "MD" },
  { label: "Massachusetts", value: "MA" },
  { label: "Michigan", value: "MI" },
  { label: "Minnesota", value: "MN" },
  { label: "Mississippi", value: "MS" },
  { label: "Missouri", value: "MO" },
  { label: "Montana", value: "MT" },
  { label: "Nebraska", value: "NE" },
  { label: "Nevada", value: "NV" },
  { label: "New Hampshire", value: "NH" },
  { label: "New Jersey", value: "NJ" },
  { label: "New Mexico", value: "NM" },
  { label: "New York", value: "NY" },
  { label: "North Carolina", value: "NC" },
  { label: "North Dakota", value: "ND" },
  { label: "Ohio", value: "OH" },
  { label: "Oklahoma", value: "OK" },
  { label: "Oregon", value: "OR" },
  { label: "Pennsylvania", value: "PA" },
  { label: "Rhode Island", value: "RI" },
  { label: "South Carolina", value: "SC" },
  { label: "South Dakota", value: "SD" },
  { label: "Tennessee", value: "TN" },
  { label: "Texas", value: "TX" },
  { label: "Utah", value: "UT" },
  { label: "Vermont", value: "VT" },
  { label: "Virginia", value: "VA" },
  { label: "Washington", value: "WA" },
  { label: "West Virginia", value: "WV" },
  { label: "Wisconsin", value: "WI" },
  { label: "Wyoming", value: "WY" },
]

export type DetailsStepProps = {
  ownerFirstName?: string
  ownerLastName?: string
  ownerEmail?: string
  ownerPhone?: string
  /** Address from session + optional zip lookup */
  addressStreet?: string
  addressCity?: string
  addressState?: string
  addressZip?: string
  onBack?: () => void
  onContinue?: (formData: {
    firstName: string
    lastName: string
    email: string
    phone: string
    mailingStreet: string
    city: string
    state: string
    zip: string
  }) => void
  continueLabel?: string
  continueDisabled?: boolean
}

// Phone number validation: exactly 10 digits, optionally hyphenated as XXX-XXX-XXXX
function isValidPhoneNumber(phone: string): boolean {
  // Remove hyphens to count digits
  const digitsOnly = phone.replace(/-/g, "")
  // Must be exactly 10 digits
  if (digitsOnly.length !== 10) return false
  // Must be all digits
  if (!/^\d+$/.test(digitsOnly)) return false
  // If hyphens are present, must be in format XXX-XXX-XXXX
  if (phone.includes("-")) {
    return /^\d{3}-\d{3}-\d{4}$/.test(phone)
  }
  return true
}

// Format phone number as XXX-XXX-XXXX as user types
function formatPhoneNumber(value: string): string {
  // Remove all non-digit characters
  const digitsOnly = value.replace(/\D/g, "")
  // Limit to 10 digits
  const limited = digitsOnly.slice(0, 10)
  // Format as XXX-XXX-XXXX
  if (limited.length <= 3) {
    return limited
  } else if (limited.length <= 6) {
    return `${limited.slice(0, 3)}-${limited.slice(3)}`
  } else {
    return `${limited.slice(0, 3)}-${limited.slice(3, 6)}-${limited.slice(6)}`
  }
}

export function DetailsStep({
  ownerFirstName = "",
  ownerLastName = "",
  ownerEmail = "",
  ownerPhone = "",
  addressStreet = "",
  addressCity = "",
  addressState = "",
  addressZip = "",
  onBack,
  onContinue,
  continueLabel = "Continue to Payment",
  continueDisabled = false,
}: DetailsStepProps) {
  const [formData, setFormData] = React.useState({
    firstName: ownerFirstName,
    lastName: ownerLastName,
    email: ownerEmail,
    phone: ownerPhone,
    mailingStreet: addressStreet,
    city: addressCity,
    state: addressState,
    zip: addressZip,
  })
  const [phoneError, setPhoneError] = React.useState<string | null>(null)

  // Update form data when props change (e.g., zip lookup updates state)
  React.useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      firstName: ownerFirstName || prev.firstName,
      lastName: ownerLastName || prev.lastName,
      email: ownerEmail || prev.email,
      phone: ownerPhone || prev.phone,
      mailingStreet: addressStreet || prev.mailingStreet,
      city: addressCity || prev.city,
      state: addressState || prev.state,
      zip: addressZip || prev.zip,
    }))
  }, [ownerFirstName, ownerLastName, ownerEmail, ownerPhone, addressStreet, addressCity, addressState, addressZip])

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value
    // Format as user types
    const formatted = formatPhoneNumber(rawValue)
    setFormData((prev) => ({ ...prev, phone: formatted }))
    
    // Validate on change (but only show error after blur or if user has started typing)
    if (formatted.length > 0 && formatted.length < 12) {
      // Still typing, don't show error yet
      setPhoneError(null)
    } else if (formatted.length === 12 || formatted.length === 10) {
      // Full length, validate
      if (!isValidPhoneNumber(formatted)) {
        setPhoneError("Phone number must be 10 digits (e.g., 425-555-6565 or 4255556565)")
      } else {
        setPhoneError(null)
      }
    }
  }

  const handlePhoneBlur = () => {
    if (formData.phone && !isValidPhoneNumber(formData.phone)) {
      setPhoneError("Phone number must be 10 digits (e.g., 425-555-6565 or 4255556565)")
    } else {
      setPhoneError(null)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Validate phone before submit
    if (!isValidPhoneNumber(formData.phone)) {
      setPhoneError("Phone number must be 10 digits (e.g., 425-555-6565 or 4255556565)")
      return
    }
    if (onContinue) {
      onContinue(formData)
    }
  }

  const handleContinue = () => {
    // Validate phone before continue
    if (!isValidPhoneNumber(formData.phone)) {
      setPhoneError("Phone number must be 10 digits (e.g., 425-555-6565 or 4255556565)")
      return
    }
    if (onContinue) {
      onContinue(formData)
    }
  }

  return (
    <div className="step-body step-body--details">
      <PartnerBar />
      <h2 className="step-body__title">Your details</h2>
      <p className="step-body__subtitle">
        Confirm your information before continuing to payment.
      </p>
      <p className="step-body__explainer">
        Required to issue your Healthy Paws policy.
      </p>
      <form className="step-form" onSubmit={handleSubmit}>
        <div className="step-form__row step-form__row--full">
          <div className="step-form__group">
            <label className="step-form__label" htmlFor="owner-first">First name</label>
            <input
              id="owner-first"
              type="text"
              className="step-form__input"
              placeholder="First name"
              value={formData.firstName}
              onChange={(e) => setFormData((prev) => ({ ...prev, firstName: e.target.value }))}
              required
            />
          </div>
          <div className="step-form__group">
            <label className="step-form__label" htmlFor="owner-last">Last name</label>
            <input
              id="owner-last"
              type="text"
              className="step-form__input"
              placeholder="Last name"
              value={formData.lastName}
              onChange={(e) => setFormData((prev) => ({ ...prev, lastName: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="step-form__group">
          <label className="step-form__label" htmlFor="owner-email">Email</label>
          <input
            id="owner-email"
            type="email"
            className="step-form__input"
            placeholder="email@example.com"
            value={formData.email}
            onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
            required
          />
        </div>
        <div className="step-form__group">
          <label className="step-form__label" htmlFor="owner-phone">Phone</label>
          <input
            id="owner-phone"
            type="tel"
            className={`step-form__input ${phoneError ? "step-form__input--error" : ""}`}
            placeholder="425-555-6565"
            value={formData.phone}
            onChange={handlePhoneChange}
            onBlur={handlePhoneBlur}
            maxLength={12}
            required
          />
          {phoneError && (
            <div className="step-form__error" role="alert">
              {phoneError}
            </div>
          )}
          <div className="step-form__hint">
            Format: 10 digits (e.g., 425-555-6565 or 4255556565)
          </div>
        </div>
        <div className="step-form__group">
          <label className="step-form__label" htmlFor="address-street">Street address</label>
          <input
            id="address-street"
            type="text"
            className="step-form__input"
            placeholder="123 Main St"
            value={formData.mailingStreet}
            onChange={(e) => setFormData((prev) => ({ ...prev, mailingStreet: e.target.value }))}
            required
          />
        </div>
        <div className="step-form__row">
          <div className="step-form__group">
            <label className="step-form__label" htmlFor="address-city">City</label>
            <input
              id="address-city"
              type="text"
              className="step-form__input"
              placeholder="City"
              value={formData.city}
              onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
              required
            />
          </div>
          <div className="step-form__group">
            <label className="step-form__label" htmlFor="address-state">State</label>
            <select
              id="address-state"
              className="step-form__input step-form__select"
              value={formData.state}
              onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
              aria-label="State"
              required
            >
              {US_STATES.map((state) => (
                <option key={state.value} value={state.value}>
                  {state.label}
                </option>
              ))}
            </select>
          </div>
          <div className="step-form__group">
            <label className="step-form__label" htmlFor="address-zip">ZIP</label>
            <input
              id="address-zip"
              type="text"
              className="step-form__input"
              placeholder="ZIP"
              value={formData.zip}
              onChange={(e) => setFormData((prev) => ({ ...prev, zip: e.target.value }))}
              required
            />
          </div>
        </div>
        <div className="step-form__group">
          <label className="step-form__checkbox-label">
            <input type="checkbox" className="step-form__checkbox" readOnly aria-readonly checked />
            <span>I agree to the terms and conditions and consent to receive policy communications.</span>
          </label>
        </div>
      </form>
      <div className="step-actions">
        {onBack && (
          <button type="button" className="btn btn--secondary step-actions__back" onClick={onBack}>
            ← Back
          </button>
        )}
        {onContinue && (
          <PrimaryActionButton
            onAction={handleContinue}
            disabled={continueDisabled}
            className={`btn btn--primary step-actions__continue ${continueDisabled ? "btn--loading" : ""}`}
          >
            {continueDisabled && <span className="btn-spinner" aria-hidden />}
            {continueLabel}
          </PrimaryActionButton>
        )}
      </div>
    </div>
  )
}
