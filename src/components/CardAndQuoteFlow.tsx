import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { getMockStep, isMockModeEnabled } from "../mocks/mockMode"
import { useSession } from "../context/SessionContext"
import { useLeadLoading } from "../context/LeadLoadingContext"
import { updateSessionStep, updateSessionCardOverlayDismissed } from "../api/session"
import { trackEnrollmentEvent } from "../api/analytics"
import { useViewportDesktop } from "../hooks/useViewportDesktop"
import { CardDisplayPanel } from "./CardDisplayPanel"
import { CardGuidedOverlay } from "./CardGuidedOverlay"
import { InsuranceOfferTeaser } from "./InsuranceOfferTeaser"
import { ReceiptSidebar } from "./insurance/ReceiptSidebar"
import { WalletModal } from "./WalletModal"
import { QuoteStep } from "../app/steps/QuoteStep"
import { DetailsStep } from "../app/steps/DetailsStep"
import { PaymentStep } from "../app/steps/PaymentStep"
import { ConfirmStep } from "../app/steps/ConfirmStep"
import type { ProcessedPlans } from "./InsuranceQuoteSelector"
import type { EnrollmentAdapter, EnrollmentResult } from "./insurance/EnrollmentAdapter"
import { HpEnrollmentAdapter } from "./insurance/HpEnrollmentAdapter"
import { MockEnrollmentAdapter } from "./insurance/MockEnrollmentAdapter"

function parseMonthlyPremium(p: Record<string, unknown>): number {
  const raw = p.monthly_premium ?? p.monthlyPremium ?? p.monthly_premium_usd
  if (typeof raw === "number" && Number.isFinite(raw)) return raw
  if (typeof raw === "string") {
    const n = parseFloat(raw.replace(/[^0-9.-]/g, ""))
    return Number.isFinite(n) ? n : NaN
  }
  return NaN
}

/** Default = lowest premium in Signature tier (or any tier if no Signature). Tie-break: higher reimbursement, then lower deductible. */
function computeDefaultPolicy(allPolicies: Record<string, unknown>[]): Record<string, unknown> | null {
  if (allPolicies.length === 0) return null
  const signaturePolicies = allPolicies.filter((p) => (p.isHighDeductible as boolean) !== true)
  const candidates = signaturePolicies.length > 0 ? signaturePolicies : allPolicies
  const withPremium = candidates
    .map((p) => ({ p, premium: parseMonthlyPremium(p) }))
    .filter(({ premium }) => Number.isFinite(premium) && premium > 0)
  if (withPremium.length === 0) return candidates[0] ?? null
  withPremium.sort((a, b) => {
    if (a.premium !== b.premium) return a.premium - b.premium
    const reimA = (a.p.reimbursement as number) ?? 0
    const reimB = (b.p.reimbursement as number) ?? 0
    if (reimB !== reimA) return reimB - reimA
    const dedA = Number(a.p.deductible) || 0
    const dedB = Number(b.p.deductible) || 0
    return dedA - dedB
  })
  return withPremium[0].p as Record<string, unknown>
}

function processInsuranceProducts(products: unknown[]): ProcessedPlans {
  if (!Array.isArray(products) || products.length === 0) {
    return {
      allReimbursements: [],
      allDeductibles: [],
      defaultPolicy: null,
      allPolicies: [],
    }
  }
  const allPolicies = products as Record<string, unknown>[]
  const allReimbursements = [
    ...new Set(
      allPolicies.map((p) =>
        Math.round(((p.reimbursement as number) || 0) * 100).toString()
      )
    ),
  ].sort()
  const allDeductibles = [
    ...new Set(allPolicies.map((p) => String(p.deductible ?? "0"))),
  ].sort((a, b) => parseInt(a, 10) - parseInt(b, 10))

  const defaultPolicy = computeDefaultPolicy(allPolicies)
  return {
    allReimbursements,
    allDeductibles,
    defaultPolicy,
    allPolicies,
  }
}

/**
 * ⚠️ ADAPTER BOUNDARY RULE:
 * 
 * Adapters are the ONLY place allowed to:
 *   - Call enrollment APIs (CreateLead, SetPlan, SetupPending, Enroll)
 *   - Mutate enrollment step (quote → details → payment → confirm)
 * 
 * ❌ FORBIDDEN elsewhere:
 *   - Direct API calls to enrollment endpoints
 *   - Direct step mutation: updateSessionStep(sessionId, "payment")
 * 
 * ✅ REQUIRED pattern:
 *   1. Call adapter method: await adapter.setPlan(input)
 *   2. Check result.step and navigate accordingly
 *   3. Update session state separately if needed
 * 
 * This ensures all step transitions are state-driven and traceable.
 */
function getEnrollmentAdapter(): EnrollmentAdapter {
  return isMockModeEnabled() ? new MockEnrollmentAdapter() : new HpEnrollmentAdapter()
}

export function CardAndQuoteFlow() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { state, refetch, setSession } = useSession()
  const mockStep = getMockStep()
  const enrollmentAdapter = React.useMemo(() => getEnrollmentAdapter(), [])
  const [selectedPlanId, setSelectedPlanId] = React.useState<"signature" | "value">("signature")
  const [selectedReimbursement, setSelectedReimbursement] = React.useState("80")
  const [selectedDeductible, setSelectedDeductible] = React.useState("500")
  // Store the actual plan_id from HP when user selects (source of truth)
  const [selectedPlanIdFromHP, setSelectedPlanIdFromHP] = React.useState<string | null>(null)
  const [transitioning, setTransitioning] = React.useState(false)
  const [transitionError, setTransitionError] = React.useState<string | null>(null)
  const [isTimeoutError, setIsTimeoutError] = React.useState(false)
  const [walletModalOpen, setWalletModalOpen] = React.useState(false)
  const [zipLookup, setZipLookup] = React.useState<{ city: string; state: string } | null>(null)
  // Store payment result from OneInc modal
  const [paymentResult, setPaymentResult] = React.useState<{
    paymentToken: string
    transactionId: string
    paymentMethod?: "CreditCard" | "ECheck"
    convenienceFee?: number
  } | null>(null)
  // Store monthly payment amount from setupPending response
  const [authorizedAmount, setAuthorizedAmount] = React.useState<number | null>(null)
  // Store accountId from setupPending (maps to OneInc policyId)
  const [sessionAccountId, setSessionAccountId] = React.useState<string | null>(null)
  // Card-first layout: insurance teaser (collapsed by default, expand on intent)
  const [insuranceExpanded, setInsuranceExpanded] = React.useState(false)
  const [teaserDismissed, setTeaserDismissed] = React.useState(false)
  const [cardSavedSuccess, setCardSavedSuccess] = React.useState(false)
  const isDesktop = useViewportDesktop()
  const cardPanelRef = React.useRef<HTMLElement | null>(null)
  const overlayShownTrackedRef = React.useRef(false)
  const [overlayDismissedLocal, setOverlayDismissedLocal] = React.useState(false)
  useLeadLoading() // hook required; retryLead available if 11014 "Try again" is re-added

  if (state.status !== "ready") return null

  const { session } = state
  const cardImageUrl = session.card_image_url ?? undefined
  const walletUrl = session.wallet_url ?? session.wallet_pass_url ?? undefined
  const memberId = (session as Record<string, unknown>).member_id as string | undefined
  const products = Array.isArray(session.insurance_products) ? session.insurance_products : []
  const processedPlans = React.useMemo(
    () => {
      const result = processInsuranceProducts(products)
      console.log("[CardAndQuoteFlow] Processed plans:", {
        productsCount: products.length,
        allPoliciesCount: result.allPolicies.length,
        defaultPolicy: result.defaultPolicy,
        allReimbursements: result.allReimbursements,
        allDeductibles: result.allDeductibles,
      })
      return result
    },
    [products]
  )

  // Hydrate quote selection from DB when session has plan, else lowest-premium Signature default. Apply only when entering quote step or session plan changes so we don't override user changes.
  const sessionPlan = (session as Record<string, unknown>)?.plan as { plan_id?: string; reimbursement?: string; deductible?: string; is_high_deductible?: boolean } | undefined
  const quoteStepActive = (mockStep ?? session.current_step ?? "quote").toLowerCase() === "quote"
  const lastQuoteSelectionAppliedRef = React.useRef<{ sessionId: string; planId: string | null }>({ sessionId: "", planId: null })
  React.useEffect(() => {
    if (!quoteStepActive || processedPlans.allPolicies.length === 0) {
      if (!quoteStepActive) lastQuoteSelectionAppliedRef.current = { sessionId: "", planId: null }
      return
    }
    const sessionId = String((session as Record<string, unknown>)?.session_id ?? "")
    const planId = sessionPlan?.plan_id ?? null
    const applied = lastQuoteSelectionAppliedRef.current
    if (applied.sessionId === sessionId && applied.planId === planId) return

    const allPolicies = processedPlans.allPolicies as Record<string, unknown>[]
    let policyToApply: Record<string, unknown> | null = null
    if (sessionPlan?.plan_id != null) {
      const inList = allPolicies.find((p) => String(p.plan_id) === String(sessionPlan.plan_id))
      if (inList) policyToApply = inList
    }
    if (policyToApply == null) policyToApply = processedPlans.defaultPolicy as Record<string, unknown> | null
    if (policyToApply) {
      const isHighDeductible = (policyToApply.isHighDeductible as boolean) ?? false
      setSelectedPlanId(isHighDeductible ? "value" : "signature")
      setSelectedReimbursement(Math.round(((policyToApply.reimbursement as number) ?? 0.8) * 100).toString())
      setSelectedDeductible(String(policyToApply.deductible ?? (isHighDeductible ? "1500" : "500")))
      setSelectedPlanIdFromHP((policyToApply.plan_id as string) ?? null)
    }
    lastQuoteSelectionAppliedRef.current = { sessionId, planId }
  }, [quoteStepActive, (session as Record<string, unknown>)?.session_id, sessionPlan?.plan_id, processedPlans.defaultPolicy, processedPlans.allPolicies.length])

  const effectiveStep = (mockStep ?? session.current_step ?? "quote").toLowerCase()

  // Source of truth for lead/quote: DB session (LeadLoadingProvider calls /lead once when both ids missing)
  const sessionAny = session as Record<string, unknown>
  const sessionLeadId = sessionAny.lead_id as string | undefined
  const sessionQuoteDetailId = sessionAny.quote_detail_id as string | undefined

  // Skip one refetch when step changed from our own Continue (we already have the returned session).
  const stepJustSetByContinueRef = React.useRef<string | null>(null)
  // DB is source of truth: refetch session when entering any step (including via Edit) so form/quote hydrate from backend.
  // On quote step when lead_id/quote_detail_id are missing, do NOT refetch — LeadLoadingProvider will call /lead and populate session; a refetch here would race and overwrite with empty insurance_products.
  React.useEffect(() => {
    if (mockStep || state.status !== "ready") return
    if (stepJustSetByContinueRef.current === effectiveStep) {
      stepJustSetByContinueRef.current = null
      return
    }
    if (effectiveStep === "quote" && !sessionLeadId && !sessionQuoteDetailId) return
    refetch()
  }, [effectiveStep, mockStep, state.status, refetch, sessionLeadId, sessionQuoteDetailId])
  // Use selectedPlanIdFromHP as source of truth (set when user selects), fallback to session.plan or default
  const effectivePlanId = selectedPlanIdFromHP ?? (sessionPlan?.plan_id ?? processedPlans.defaultPolicy?.plan_id ?? null) as string | null

  const handlePlanChange = (planId: "signature" | "value") => {
    setSelectedPlanId(planId)
    const isHighDeductible = planId === "value"
    // Find the first policy matching the plan type (Signature or Value)
    const matchingPolicy = processedPlans.allPolicies.find(
      (p) => (p.isHighDeductible as boolean) === isHighDeductible
    )
    if (matchingPolicy) {
      const reimbursement = Math.round(((matchingPolicy.reimbursement as number) || 0.8) * 100).toString()
      const deductible = String(matchingPolicy.deductible ?? (isHighDeductible ? "1500" : "500"))
      setSelectedReimbursement(reimbursement)
      setSelectedDeductible(deductible)
      setSelectedPlanIdFromHP((matchingPolicy.plan_id as string) ?? null)
    } else {
      // Fallback if no matching policy found
      setSelectedReimbursement("80")
      setSelectedDeductible(isHighDeductible ? "1500" : "500")
      setSelectedPlanIdFromHP(null)
    }
  }

  // API returns pet.name (e.g. "Beau"); fallback to capitalized "Your Pet" when missing
  const petNameRaw = (session.pet as Record<string, unknown>)?.name as string | undefined
  const petNameTrimmed = typeof petNameRaw === "string" ? petNameRaw.trim() : ""
  const displayPetName = petNameTrimmed.length > 0 ? petNameTrimmed : (mockStep ? "Fluffy" : "Your Pet")

  // Pet age for receipt sidebar: use session.pet.age if present, else derive from birth_year
  const receiptPetAge = (() => {
    const pet = session.pet as Record<string, unknown> | undefined
    const ageStr = pet?.age as string | undefined
    if (ageStr && String(ageStr).trim().length > 0) return String(ageStr).trim()
    const birthYear = pet?.birth_year as number | undefined
    if (birthYear && typeof birthYear === "number") {
      const years = new Date().getFullYear() - birthYear
      if (years <= 0) return "Less than 1 year"
      return years === 1 ? "1 year old" : `${years} years old`
    }
    return undefined
  })()

  const sessionOwner = session.owner as Record<string, unknown> | undefined
  const detailsZip = (() => {
    const pet = session.pet as Record<string, unknown> | undefined
    return (pet?.zip_code ?? sessionOwner?.zip ?? "") as string
  })()
  const detailsCity = (sessionOwner?.city as string) ?? zipLookup?.city ?? ""
  const detailsState = (sessionOwner?.state as string) ?? zipLookup?.state ?? ""
  const detailsStreet = (sessionOwner?.mailing_street as string) ?? ""

  React.useEffect(() => {
    if (!detailsZip || detailsZip.length < 5) {
      setZipLookup(null)
      return
    }
    const zip = detailsZip.slice(0, 5).replace(/\D/g, "")
    if (zip.length < 5) return
    let cancelled = false
    fetch(`https://api.zippopotam.us/us/${zip}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { places?: Array<{ "place name"?: string; "state abbreviation"?: string }> } | null) => {
        if (cancelled || !data?.places?.length) return
        const place = data.places[0]
        setZipLookup({
          city: place["place name"] ?? "",
          state: place["state abbreviation"] ?? "",
        })
      })
      .catch(() => setZipLookup(null))
    return () => { cancelled = true }
  }, [detailsZip])

  const isCardFirstLayout = searchParams.get("layout") === "card-first"

  const ctaByStep: Record<string, { label: string; nextMock?: "details" | "payment" | "confirm" }> = {
    quote: { label: "Continue to Details", nextMock: "details" },
    details: { label: "Continue to Payment", nextMock: "payment" },
    payment: { label: "Continue", nextMock: "confirm" },
    confirm: { label: "Complete Enrollment" },
  }
  const cta = ctaByStep[effectiveStep] ?? ctaByStep.quote

  /**
   * State-driven step transitions: UI advances only when adapter mutates state successfully
   * 
   * ⚠️ This is the ONLY place that should navigate based on enrollment adapter results.
   * All enrollment transitions must go through adapter methods.
   */
  const handleCtaClick = async (formDataOverride?: {
    firstName: string
    lastName: string
    email: string
    phone: string
    mailingStreet: string
    city: string
    state: string
    zip: string
  }) => {
    if (state.status !== "ready" || transitioning) return
    setTransitionError(null)
    setIsTimeoutError(false)
    if (effectiveStep === "quote") {
      trackEnrollmentEvent("insurance_cta_clicked", eventMetadata)
    }

    // Use formDataOverride from DetailsStep onContinue; fallback to session.owner (DB source of truth)
    const ownerForForm = session.owner as Record<string, unknown> | undefined
    const activeFormData = formDataOverride ?? (ownerForForm ? {
      firstName: (ownerForForm.first_name as string) ?? "",
      lastName: (ownerForForm.last_name as string) ?? "",
      email: (ownerForForm.email as string) ?? "",
      phone: (ownerForForm.phone as string) ?? "",
      mailingStreet: (ownerForForm.mailing_street as string) ?? "",
      city: (ownerForForm.city as string) ?? "",
      state: (ownerForForm.state as string) ?? "",
      zip: (ownerForForm.zip as string) ?? "",
    } : null)
    
    // Mock mode: use query param navigation (preserves existing mock behavior)
    if (mockStep && cta.nextMock) {
      const next = new URLSearchParams(searchParams)
      next.set("mock", cta.nextMock)
      setSearchParams(next, { replace: true })
      return
    }
    if (mockStep && effectiveStep === "confirm") return
    
    setTransitioning(true)
    try {
      let result: EnrollmentResult | null = null
      
      if (effectiveStep === "quote") {
        // Continue to Details = SetPlan only. Lead is called once by LeadLoadingProvider when session has no ids.
        const owner = session.owner as Record<string, unknown>
        const pet = session.pet as Record<string, unknown>
        
        if (!sessionLeadId || !sessionQuoteDetailId) {
          if (products.length > 0) {
            setTransitionError("Quote data didn’t load correctly. Please refresh the page to load your quote again.")
          } else {
            setTransitionError("Please wait for your quote to load, then click Continue to Details.")
          }
          setTransitioning(false)
          return
        }
        
        // VALIDATION GATE: Verify selected plan exists in HP-returned policies
        if (!effectivePlanId) {
          setTransitionError("Please select a plan option before continuing.")
          setTransitioning(false)
          return
        }
        
        const selectedPolicy = processedPlans.allPolicies.find(
          (p) => (p.plan_id as string) === effectivePlanId
        )
        
        if (!selectedPolicy) {
          console.error("[CardAndQuoteFlow] Selected plan_id not found in HP policies:", {
            selectedPlanId: effectivePlanId,
            availablePlanIds: processedPlans.allPolicies.map((p) => p.plan_id),
            selectedReimbursement,
            selectedDeductible,
            selectedPlanType: selectedPlanId,
          })
          setTransitionError("The selected plan is not available. Please select a different option.")
          setTransitioning(false)
          return
        }
        
        // Triple-check: reimbursement, deductible, AND plan type (isHighDeductible) match
        const policyReimbursement = Math.round(((selectedPolicy.reimbursement as number) || 0) * 100).toString()
        const policyDeductible = String(selectedPolicy.deductible)
        const policyIsHighDeductible = (selectedPolicy.isHighDeductible as boolean) ?? false
        const expectedIsHighDeductible = selectedPlanId === "value"
        if (
          policyReimbursement !== selectedReimbursement ||
          policyDeductible !== selectedDeductible ||
          policyIsHighDeductible !== expectedIsHighDeductible
        ) {
          console.error("[CardAndQuoteFlow] Plan mismatch:", {
            planId: effectivePlanId,
            policyReimbursement,
            selectedReimbursement,
            policyDeductible,
            selectedDeductible,
            policyIsHighDeductible,
            expectedIsHighDeductible,
            selectedPlanType: selectedPlanId,
          })
          setTransitionError("Plan selection mismatch. Please refresh and try again.")
          setTransitioning(false)
          return
        }
        
        const planId = effectivePlanId
        const ownerEmail = (owner.email || "") as string
        const zipCode = (pet.zip_code || (owner as Record<string, unknown>).zip_code || "") as string
        if (!zipCode) {
          setTransitionError("Missing zip code. Please check your pet information.")
          return
        }
        
        // Call SetPlan (HP requires: affiliateCode, zipCode, emailAddress, quoteDetailId, planId)
        result = await enrollmentAdapter.setPlan({
          emailAddress: ownerEmail,
          affiliateCode: "FLEXEMBD",
          zipCode,
          quoteDetailId: sessionQuoteDetailId,
          planId,
        })
        
        if (result.error) {
          setTransitionError(result.error)
          return
        }
        
        // Single PATCH: update step + full plan; replace in-memory session with returned session (no optimistic merge).
        const returned = await updateSessionStep(session.session_id, "details", {
          plan: {
            plan_id: planId,
            reimbursement: selectedReimbursement,
            deductible: selectedDeductible,
            is_high_deductible: selectedPlanId === "value",
          },
        })
        stepJustSetByContinueRef.current = "details"
        setSession(returned)
        setTransitioning(false)
        return
      } else if (effectiveStep === "details") {
        // Step 2 → 3: SetupPending
        const owner = session.owner as Record<string, unknown>
        const pet = session.pet as Record<string, unknown>
        
        if (!sessionLeadId) {
          setTransitionError("Missing leadId. Please start from the quote step.")
          return
        }
        
        // Validate form data was collected
        if (!activeFormData) {
          setTransitionError("Please fill out all required fields before continuing.")
          setTransitioning(false)
          return
        }
        
        // Validate required fields
        if (!activeFormData.firstName?.trim() || !activeFormData.lastName?.trim() || !activeFormData.email?.trim()) {
          setTransitionError("Please fill out first name, last name, and email.")
          setTransitioning(false)
          return
        }
        
        if (!activeFormData.phone?.trim() || !activeFormData.mailingStreet?.trim() || !activeFormData.state?.trim()) {
          setTransitionError("Please fill out phone number, street address, and state.")
          setTransitioning(false)
          return
        }
        
        const acceptElectronicConsent = true

        // Session pet has birth_month/birth_year; HP API requires dateOfBirth as YYYY-MM-DD (no empty string)
        const rawMonth = pet.birth_month as number | undefined | null
        const rawYear = pet.birth_year as number | undefined | null
        const birthMonth = typeof rawMonth === "number" && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : undefined
        const birthYear = typeof rawYear === "number" && rawYear > 1900 && rawYear < 2100 ? rawYear : undefined
        let petDateOfBirth = (pet.date_of_birth as string)?.trim() || ""
        if (!petDateOfBirth && (birthYear != null || birthMonth != null)) {
          if (birthYear != null && birthMonth != null) {
            petDateOfBirth = `${birthYear}-${String(birthMonth).padStart(2, "0")}-01`
          } else if (birthYear != null) {
            petDateOfBirth = `${birthYear}-01-01`
          }
        }
        if (!petDateOfBirth || petDateOfBirth.length < 8) {
          console.error("[CardAndQuoteFlow] Missing pet date of birth:", {
            pet_date_of_birth: pet.date_of_birth,
            pet_birth_month: rawMonth,
            pet_birth_year: rawYear,
            computed_birthMonth: birthMonth,
            computed_birthYear: birthYear,
            computed_petDateOfBirth: petDateOfBirth,
          })
          setTransitionError("Pet date of birth is required to continue. Please check your pet details.")
          setTransitioning(false)
          return
        }

        // Normalize phone number: remove spaces and parentheses, but keep hyphens if present
        // API accepts: 10 digits (4255556565) or 10 digits hyphenated (425-555-6565)
        const normalizedPhone = activeFormData.phone.replace(/\s|\(|\)/g, "")
        
        // Validate phone format: must be exactly 10 digits (with or without hyphens)
        const digitsOnly = normalizedPhone.replace(/-/g, "")
        if (digitsOnly.length !== 10 || !/^\d+$/.test(digitsOnly)) {
          setTransitionError("Phone number must be exactly 10 digits (e.g., 425-555-6565 or 4255556565)")
          setTransitioning(false)
          return
        }
        // If hyphens are present, must be in format XXX-XXX-XXXX
        if (normalizedPhone.includes("-") && !/^\d{3}-\d{3}-\d{4}$/.test(normalizedPhone)) {
          setTransitionError("Phone number format is invalid. Use 425-555-6565 or 4255556565")
          setTransitioning(false)
          return
        }

        // Use form data, fallback to session data, then zipLookup for state
        const stateCode = activeFormData.state?.trim() || zipLookup?.state || ""
        if (!stateCode) {
          setTransitionError("State is required. Please select a state.")
          setTransitioning(false)
          return
        }

        result = await enrollmentAdapter.setupPending({
          lead: {
            emailAddress: activeFormData.email.trim(),
            affiliateCode: "FLEXEMBD",
            zipCode: activeFormData.zip?.trim() || (pet.zip_code || owner.zip_code || "") as string,
            stateCode,
            firstName: activeFormData.firstName.trim(),
            lastName: activeFormData.lastName.trim(),
            mailingStreet: activeFormData.mailingStreet.trim(),
            phone: normalizedPhone,
            leadId: sessionLeadId,
          },
          pets: [{
            name: (pet.name || "") as string,
            speciesType: ((pet.type || "dog") as string).toUpperCase() as "DOG" | "CAT",
            breedType: String(pet.breed_id || ""),
            dateOfBirth: petDateOfBirth,
            genderType: ((pet.sex || "male") as string).toUpperCase() as "MALE" | "FEMALE",
            deductible: parseInt(selectedDeductible, 10),
            reimbursement: parseInt(selectedReimbursement, 10),
          }],
          acceptElectronicConsent,
        })
        
        if (!result) {
          setTransitionError("SetupPending failed")
          return
        }
        
        if (result.error) {
          // Check if error is a timeout (from adapter or backend)
          const errorStr = result.error
          const isTimeout = errorStr.includes("too long") || errorStr.includes("timeout") || errorStr.includes("Timeout")
          setIsTimeoutError(isTimeout)
          setTransitionError(result.error)
          setTransitioning(false)
          return
        }
        
        // Clear timeout error flag on success
        setIsTimeoutError(false)
        
        // Extract monthlyTotalPayment and accountId from setupPending response
        if (result && typeof (result as { monthlyTotalPayment?: number }).monthlyTotalPayment === "number") {
          setAuthorizedAmount((result as { monthlyTotalPayment: number }).monthlyTotalPayment)
        }
        if (result && typeof (result as { accountId?: string }).accountId === "string") {
          setSessionAccountId((result as { accountId: string }).accountId)
        }

        // Persist details step: full owner + consent; replace session with PATCH response.
        const returned = await updateSessionStep(session.session_id, "payment", {
          owner: {
            first_name: activeFormData.firstName.trim(),
            last_name: activeFormData.lastName.trim(),
            email: activeFormData.email.trim(),
            phone: normalizedPhone,
            mailing_street: activeFormData.mailingStreet.trim(),
            city: activeFormData.city?.trim() ?? "",
            state: stateCode,
            zip: activeFormData.zip?.trim() ?? "",
          },
          accept_electronic_consent: true,
        })
        stepJustSetByContinueRef.current = "payment"
        setSession(returned)
        setTransitioning(false)
        return
      } else if (effectiveStep === "payment") {
        // Step 3 → 4: Enroll
        const owner = session.owner as Record<string, unknown>
        const pet = session.pet as Record<string, unknown>
        
        if (!sessionLeadId) {
          setTransitionError("Missing leadId. Please start from the quote step.")
          return
        }
        
        // Validate payment result from OneInc
        if (!paymentResult || !paymentResult.paymentToken || !paymentResult.transactionId) {
          setTransitionError("Please complete the payment form before continuing.")
          setTransitioning(false)
          return
        }
        
        // Use form data for billing details, fallback to session data
        const billingFirstName = (owner.first_name || "") as string
        const billingLastName = (owner.last_name || "") as string
        const billingStreet = (owner.mailing_street ?? owner.street ?? "") as string
        const billingCity = (owner.city || "") as string
        const billingState = (zipLookup?.state ?? pet.state_code ?? owner.state_code ?? "") as string
        const billingPostalCode = (pet.zip_code ?? owner.zip ?? "") as string
        
        if (!billingFirstName || !billingLastName || !billingStreet || !billingCity || !billingState || !billingPostalCode) {
          setTransitionError("Missing billing information. Please check your details.")
          setTransitioning(false)
          return
        }
        
        // Use authorizedAmount from setupPending response (HP's authoritative amount)
        // Fallback to monthlyPrice if not available
        const finalAuthorizedAmount = authorizedAmount ?? parseFloat(monthlyPrice)
        
        if (!finalAuthorizedAmount || finalAuthorizedAmount <= 0) {
          setTransitionError("Invalid payment amount. Please refresh and try again.")
          setTransitioning(false)
          return
        }
        
        // Payment details from OneInc modal
        // HP requires: transactionId, paymentToken, authorizedAmount, billing fields, paymentMethod
        const paymentDetails = {
          transactionId: paymentResult.transactionId,
          paymentToken: paymentResult.paymentToken,
          authorizedAmount: finalAuthorizedAmount,
          billingFirstName,
          billingLastName,
          billingStreet,
          billingCity,
          billingState,
          billingPostalCode,
          paymentMethod: paymentResult.paymentMethod || "CreditCard" as const,
          // Convenience fee: CreditCard transactions require this, ECheck uses 0
          // TODO: Get actual convenience fee from HP or OneInc response
          convenienceFee: paymentResult.convenienceFee ?? (paymentResult.paymentMethod === "ECheck" ? 0 : undefined),
        }
        
        result = await enrollmentAdapter.enroll({
          lead: {
            emailAddress: (owner.email || "") as string,
            affiliateCode: "FLEXEMBD",
            zipCode: (pet.zip_code || owner.zip_code || "") as string,
            stateCode: (pet.state_code || owner.state_code || "") as string,
            firstName: (owner.first_name || "") as string,
            lastName: (owner.last_name || "") as string,
            mailingStreet: (owner.mailing_street || owner.street || "") as string,
            phone: (owner.phone || "") as string,
            acceptElectronicConsent: true,
            leadId: sessionLeadId,
          },
          paymentDetails,
        })
        
        if (result.error) {
          setTransitionError(result.error)
          return
        }

        const returned = await updateSessionStep(session.session_id, "confirm")
        stepJustSetByContinueRef.current = "confirm"
        setSession(returned)
        setTransitioning(false)
        return
      }
    } catch (error) {
      setTransitionError(error instanceof Error ? error.message : "Something went wrong. Please try again.")
    } finally {
      setTransitioning(false)
    }
  }

  const planName = selectedPlanId === "signature" ? "Signature Plan" : "Value Plan"
  const isSignature = selectedPlanId === "signature"
  const selectedPolicy = processedPlans.allPolicies.find(
    (p) =>
      (p.isHighDeductible as boolean) === !isSignature &&
      Math.round(((p.reimbursement as number) || 0) * 100).toString() === selectedReimbursement &&
      String(p.deductible) === selectedDeductible
  )
  const monthlyPrice = (selectedPolicy?.monthly_premium as string) ?? (selectedPolicy?.monthly_price as string) ?? "34.99"
  
  // Check if current selection is valid (exists in HP policies)
  const isSelectionValid = selectedPolicy !== undefined && selectedPolicy.plan_id !== undefined

  function renderStepBody() {
    switch (effectiveStep) {
      case "details":
        return (
          <DetailsStep
            key={`details-${detailsZip}-${detailsCity}-${detailsState}`}
            ownerFirstName={(sessionOwner?.first_name as string) ?? ""}
            ownerLastName={(sessionOwner?.last_name as string) ?? ""}
            ownerEmail={(sessionOwner?.email as string) ?? ""}
            ownerPhone={(sessionOwner?.phone as string) ?? ""}
            addressStreet={detailsStreet}
            addressZip={detailsZip}
            addressCity={detailsCity}
            addressState={detailsState}
            onBack={mockStep ? () => {
              const next = new URLSearchParams(searchParams)
              next.set("mock", "quote")
              setSearchParams(next, { replace: true })
            } : undefined}
            onContinue={(formData) => {
              // Pass formData directly to handleCtaClick to avoid async state update race condition
              handleCtaClick(formData)
            }}
            continueLabel={cta.label}
            continueDisabled={transitioning}
          />
        )
      case "payment":
        return (
          <PaymentStep
            leadId={sessionLeadId || undefined}
            accountId={sessionAccountId || undefined}
            amount={authorizedAmount || parseFloat(monthlyPrice)}
            onPaymentSuccess={(result) => {
              setPaymentResult({
                paymentToken: result.paymentToken,
                transactionId: result.transactionId,
                paymentMethod: result.paymentMethod,
                convenienceFee: result.convenienceFee,
              })
            }}
            onBack={mockStep ? () => {
              const next = new URLSearchParams(searchParams)
              next.set("mock", "details")
              setSearchParams(next, { replace: true })
            } : undefined}
            onReview={() => handleCtaClick()}
            reviewLabel={cta.label}
            reviewDisabled={!paymentResult}
          />
        )
      case "confirm":
        return (
          <ConfirmStep
            petName={displayPetName}
            petType={(session.pet as Record<string, unknown>)?.type as string}
            petBreedId={(session.pet as Record<string, unknown>)?.breed_id as number | undefined}
            planName={planName}
            deductible={selectedDeductible}
            reimbursement={selectedReimbursement}
            monthlyPrice={monthlyPrice}
            policyNumber={(session as Record<string, unknown>).policy_number as string}
            effectiveDate={(session as Record<string, unknown>).effective_date as string}
          />
        )
      case "quote":
      default:
        console.log("[CardAndQuoteFlow] Rendering quote step:", {
          allPoliciesCount: processedPlans.allPolicies.length,
          productsCount: products.length,
          effectiveStep,
        })
        const is11014 = (sessionAny.lead_request_last_error_code as string) === "11014"
        const retrieveQuoteUrl = (sessionAny.last_hp_retrieve_quote_url as string) || undefined
        if (processedPlans.allPolicies.length > 0) {
          return (
            <QuoteStep
              processedPlans={processedPlans}
              selectedPlanId={selectedPlanId}
              selectedReimbursement={selectedReimbursement}
              selectedDeductible={selectedDeductible}
              onPlanChange={handlePlanChange}
              onSelectionChange={(r, d) => {
                setSelectedReimbursement(r)
                setSelectedDeductible(d)
                // Find and store the actual plan_id from HP policies
                // Must match plan type (Signature vs Value) using isHighDeductible
                const matchingPolicy = processedPlans.allPolicies.find(
                  (p) =>
                    (p.isHighDeductible as boolean) === !isSignature &&
                    Math.round(((p.reimbursement as number) || 0) * 100).toString() === r &&
                    String(p.deductible) === d
                )
                if (matchingPolicy?.plan_id) {
                  setSelectedPlanIdFromHP(matchingPolicy.plan_id as string)
                } else {
                  // Clear if no match (shouldn't happen if UI is correct, but defensive)
                  setSelectedPlanIdFromHP(null)
                }
              }}
              petName={displayPetName}
              petType={(session.pet as Record<string, unknown>)?.type as string}
              petBreedId={(session.pet as Record<string, unknown>)?.breed_id as number | undefined}
              onContinue={() => handleCtaClick()}
              continueLabel={cta.label}
              continueDisabled={transitioning || !isSelectionValid}
            />
          )
        }
        if (is11014) {
          const debug = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("debug") === "1"
          if (debug) {
            console.log("[CardAndQuoteFlow] 11014 recovery: resume_session_id =", !!sessionAny.resume_session_id, "retrieve_quote_url =", !!retrieveQuoteUrl)
          }
          const ownerEmail = (session.owner as Record<string, unknown>)?.email as string | undefined
          const displayEmail = ownerEmail != null && String(ownerEmail).trim() ? String(ownerEmail).trim() : ""
          const resumeSessionId = (sessionAny.resume_session_id as string) || undefined
          const hasResume = !!resumeSessionId

          const handleContinueWhereLeftOff = () => {
            if (!resumeSessionId) return
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev)
              next.set("session_id", resumeSessionId)
              return next
            }, { replace: true })
          }

          const handleStartNewQuote = async () => {
            try {
              const returned = await updateSessionStep(session.session_id, "details")
              setSession(returned)
              await refetch()
            } catch (e) {
              setTransitionError(e instanceof Error ? e.message : "Could not go to details.")
            }
          }

          if (hasResume) {
            return (
              <>
                <div className="quote-step__header" style={{ marginBottom: 0 }}>
                  <div className="quote-step__header-content">
                    <div className="quote-step__header-text" style={{ flex: 1 }}>
                      <h2 className="quote-step__title">Continue your Healthy Paws quote</h2>
                      <p className="quote-step__subtitle">
                        We can&apos;t generate a new quote in-app right now. You can continue your quote on Healthy Paws or change your email and try again.
                      </p>
                    </div>
                  </div>
                </div>
                <div
                  className="resume-modal-overlay"
                  style={{
                    position: "fixed",
                    inset: 0,
                    background: "rgba(0,0,0,0.4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    zIndex: 1000,
                    padding: 16,
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="resume-modal-title"
                >
                  <div
                    className="resume-modal"
                    style={{
                      background: "#fff",
                      borderRadius: 12,
                      padding: 24,
                      maxWidth: 420,
                      width: "100%",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h2 id="resume-modal-title" className="quote-step__title" style={{ marginTop: 0 }}>
                      We&apos;ve found an existing quote for you.
                    </h2>
                    <p className="quote-step__subtitle" style={{ marginBottom: 20 }}>
                      It looks like you previously started a quote. You can continue where you left off.
                    </p>
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <button type="button" className="btn btn--primary" onClick={handleContinueWhereLeftOff}>
                        Continue where I left off
                      </button>
                      <button type="button" className="btn btn--secondary" onClick={handleStartNewQuote}>
                        Start new quote
                      </button>
                      {retrieveQuoteUrl ? (
                        <button
                          type="button"
                          className="btn btn--secondary"
                          onClick={() => window.open(retrieveQuoteUrl, "_blank")}
                        >
                          Continue on Healthy Paws
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </>
            )
          }

          return (
            <div className="quote-step__header" style={{ marginBottom: 0 }}>
              <div className="quote-step__header-content">
                <div className="quote-step__header-text" style={{ flex: 1 }}>
                  <h2 className="quote-step__title">You&apos;ve already got an amazing quote from Healthy Paws</h2>
                  <p className="quote-step__subtitle">
                    You can continue your quote by clicking the Continue Quote button below.
                  </p>
                </div>
              </div>
              <div className="plan-container plan-container--signature">
                <div className="plan-container__header">
                  <h4 className="plan-container__title">Healthy Paws Pet Insurance</h4>
                </div>
                <div className="plan-container__options" style={{ paddingTop: 12 }}>
                  <ul className="quote-11014-value-props" style={{ margin: "0 0 20px 0", paddingLeft: 20, color: "#555", fontSize: 14, lineHeight: 1.6 }}>
                    <li>Unlimited lifetime benefits</li>
                    <li>Fast, simple claims</li>
                    <li>No network restrictions</li>
                  </ul>
                </div>
                <div className="plan-container__summary">
                  <div className="quote-summary-card">
                    <div className="quote-summary-card__content" style={{ flexDirection: "column", gap: 16 }}>
                      {displayEmail ? (
                        <p style={{ margin: 0, fontSize: 13, color: "#5d6d7e" }}>
                          Continue for <strong style={{ color: "#2c3e50" }}>{displayEmail}</strong>
                        </p>
                      ) : null}
                      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                        {retrieveQuoteUrl ? (
                          <a
                            href={retrieveQuoteUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn btn--primary"
                            style={{ textAlign: "center", textDecoration: "none" }}
                          >
                            Continue Quote
                          </a>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
        }
        return (
          <div className="quoteEmpty">
            <h3>Insurance Quotes Coming Soon</h3>
            <p>
              We&apos;re preparing personalized insurance options for your pet.
              You can save your PetRx card now — we&apos;ll notify you when quotes are ready.
            </p>
            <p style={{ fontSize: "12px", color: "#666", marginTop: "8px" }}>
              Debug: products={products.length}, allPolicies={processedPlans.allPolicies.length}
            </p>
          </div>
        )
    }
  }

  const handleEdit = async (step: "quote" | "details" | "payment") => {
    if (mockStep) {
      const next = new URLSearchParams(searchParams)
      next.set("mock", step)
      setSearchParams(next, { replace: true })
      return
    }
    try {
      await updateSessionStep(session.session_id, step)
      await refetch()
    } catch (e) {
      setTransitionError(e instanceof Error ? e.message : "Could not go back to that step.")
    }
  }

  const showCardFirstLayout =
    effectiveStep === "quote" &&
    isCardFirstLayout &&
    processedPlans.allPolicies.length > 0 &&
    (sessionAny.lead_request_last_error_code as string) !== "11014"

  const eventMetadata = React.useMemo(
    () => ({
      session_id: session.session_id,
      member_id: memberId ?? undefined,
      current_step: effectiveStep,
      layout: isCardFirstLayout ? "card-first" : "default",
      viewport_bucket: (isDesktop ? "desktop" : "mobile") as "desktop" | "mobile",
    }),
    [session.session_id, memberId, effectiveStep, isCardFirstLayout, isDesktop]
  )

  const showOverlay =
    effectiveStep === "quote" &&
    processedPlans.allPolicies.length > 0 &&
    !(session as Record<string, unknown>).card_overlay_dismissed &&
    !overlayDismissedLocal &&
    isDesktop &&
    (sessionAny.lead_request_last_error_code as string) !== "11014"

  React.useEffect(() => {
    if (showOverlay && !overlayShownTrackedRef.current) {
      overlayShownTrackedRef.current = true
      trackEnrollmentEvent("card_overlay_shown", eventMetadata)
    }
    if (!showOverlay) overlayShownTrackedRef.current = false
  }, [showOverlay, eventMetadata])

  const handleOverlayDismiss = React.useCallback(
    (reason: "click" | "esc" | "timeout") => {
      setOverlayDismissedLocal(true)
      trackEnrollmentEvent("card_overlay_dismissed", { ...eventMetadata, dismiss_reason: reason })
      updateSessionCardOverlayDismissed(session.session_id)
        .then(setSession)
        .catch(() => {})
    },
    [session.session_id, eventMetadata, setSession]
  )

  const cardFirstStartingPriceMo = processedPlans.defaultPolicy
    ? parseMonthlyPremium(processedPlans.defaultPolicy)
    : NaN
  const startingPriceMo = Number.isFinite(cardFirstStartingPriceMo) ? cardFirstStartingPriceMo : null

  const doCardDownload = React.useCallback(() => {
    trackEnrollmentEvent("card_image_download_clicked", eventMetadata)
    if (!cardImageUrl) return
    const link = document.createElement("a")
    link.href = cardImageUrl
    link.download = `${memberId ?? "card"}-card.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [cardImageUrl, memberId, eventMetadata])

  const handleCardDownload = React.useCallback(() => {
    setCardSavedSuccess(true)
    doCardDownload()
  }, [doCardDownload])

  return (
    <div className={`card-and-quote-flow${showCardFirstLayout ? " card-and-quote-flow--card-first" : ""}`}>
      {showOverlay && (
        <CardGuidedOverlay cardPanelRef={cardPanelRef} onDismiss={handleOverlayDismiss} />
      )}
      {showCardFirstLayout ? (
        <div className="card-first-grid">
          <section className="card-first-hero" aria-label="Your PetRx card">
            <h1 className="card-first-hero__title">Your PetRx Prescription Savings Card is Ready</h1>
            <p className="card-first-hero__subtitle">Save on your pet&apos;s medications at pharmacies nationwide.</p>
            <div ref={cardPanelRef as React.RefObject<HTMLDivElement>} className="card-first-hero__card-wrap">
            {cardImageUrl ? (
              <CardDisplayPanel
                cardImageUrl={cardImageUrl}
                walletUrl={walletUrl}
                memberId={memberId}
                petName={displayPetName}
                onAddToWallet={() => {
                  trackEnrollmentEvent("wallet_add_clicked", eventMetadata)
                  setCardSavedSuccess(true)
                  setWalletModalOpen(true)
                }}
                onDownload={handleCardDownload}
              />
            ) : (
              <div className="cardPanel card-display-panel-empty">
                <div className="cardPanel__header">
                  <h2>Your Digital Card</h2>
                </div>
                <p className="cardPanel__note">Card image will appear when available.</p>
              </div>
            )}
            </div>
            {cardSavedSuccess && (
              <p className="card-first-hero__saved-nudge">Saved — you&apos;re all set.</p>
            )}
          </section>
          {!teaserDismissed && (
            <section className="card-first-insurance" aria-label="Insurance options">
              {!insuranceExpanded ? (
                <InsuranceOfferTeaser
                  petName={displayPetName}
                  startingPriceMo={startingPriceMo}
                  onExpand={() => {
                    trackEnrollmentEvent("insurance_teaser_expand_clicked", eventMetadata)
                    setInsuranceExpanded(true)
                  }}
                  onDismiss={() => setTeaserDismissed(true)}
                  postSaveCopy={cardSavedSuccess}
                />
              ) : (
                <div className="card-first-insurance-expanded">
                  <QuoteStep
                    processedPlans={processedPlans}
                    selectedPlanId={selectedPlanId}
                    selectedReimbursement={selectedReimbursement}
                    selectedDeductible={selectedDeductible}
                    onPlanChange={handlePlanChange}
                    onSelectionChange={(r, d) => {
                      setSelectedReimbursement(r)
                      setSelectedDeductible(d)
                      const matchingPolicy = processedPlans.allPolicies.find(
                        (p) =>
                          (p.isHighDeductible as boolean) === !isSignature &&
                          Math.round(((p.reimbursement as number) || 0) * 100).toString() === r &&
                          String(p.deductible) === d
                      )
                      if (matchingPolicy?.plan_id) {
                        setSelectedPlanIdFromHP(matchingPolicy.plan_id as string)
                      } else {
                        setSelectedPlanIdFromHP(null)
                      }
                    }}
                    petName={displayPetName}
                    petType={(session.pet as Record<string, unknown>)?.type as string}
                    petBreedId={(session.pet as Record<string, unknown>)?.breed_id as number | undefined}
                    onContinue={() => handleCtaClick()}
                    continueLabel="Continue to Details"
                    continueDisabled={transitioning || !isSelectionValid}
                    title={`Bonus: Protect ${displayPetName} from unexpected vet bills`}
                    subtitle="Healthy Paws coverage options (optional)"
                    variant="secondary"
                  />
                </div>
              )}
            </section>
          )}
          {transitionError && (
            <p className="start-error" style={{ marginTop: 12, marginBottom: 0 }}>
              {transitionError}
            </p>
          )}
        </div>
      ) : (
        <div className="card-and-quote-grid">
          <section ref={cardPanelRef} className="card-panel">
            {effectiveStep === "quote" || effectiveStep === "confirm" ? (
              <>
                {cardImageUrl ? (
                  <CardDisplayPanel
                    cardImageUrl={cardImageUrl}
                    walletUrl={walletUrl}
                    memberId={memberId}
                    petName={displayPetName}
                    onAddToWallet={() => {
                      trackEnrollmentEvent("wallet_add_clicked", eventMetadata)
                      setWalletModalOpen(true)
                    }}
                    onDownload={doCardDownload}
                  />
                ) : (
                  <div className="cardPanel card-display-panel-empty">
                    <div className="cardPanel__header">
                      <h2>Your Digital Card</h2>
                    </div>
                    <p className="cardPanel__note">Card image will appear when available.</p>
                  </div>
                )}
              </>
            ) : (
            <ReceiptSidebar
              currentStep={effectiveStep as "quote" | "details" | "payment" | "confirm"}
              petName={displayPetName}
              petType={(session.pet as Record<string, unknown>)?.type as string}
              petBreed={((session.pet as Record<string, unknown>)?.breed_label ?? (session.pet as Record<string, unknown>)?.breed) as string}
              petBreedId={(session.pet as Record<string, unknown>)?.breed_id as number | undefined}
              petAge={receiptPetAge}
              planName={planName}
              reimbursement={selectedReimbursement}
              deductible={selectedDeductible}
              monthlyPrice={monthlyPrice}
              ownerFirstName={((session.owner as Record<string, unknown>)?.first_name as string) ?? ""}
              ownerLastName={((session.owner as Record<string, unknown>)?.last_name as string) ?? ""}
              ownerEmail={((session.owner as Record<string, unknown>)?.email as string) ?? ""}
              onEdit={handleEdit}
            />
          )}
        </section>
        <section className="quote-panel">
          {renderStepBody()}
          {transitionError && effectiveStep === "quote" && (
            <p className="start-error" style={{ marginTop: 12, marginBottom: 0 }}>
              {transitionError}
            </p>
          )}
          {transitionError && effectiveStep === "details" && (
            <div className="step-error" style={{ marginTop: 16, padding: "12px 16px", background: "#fee", border: "1px solid #fcc", borderRadius: "8px" }}>
              <p style={{ margin: "0 0 8px 0", color: "#c33", fontSize: "14px" }}>
                {transitionError}
              </p>
              {isTimeoutError && (
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => handleCtaClick()}
                  disabled={transitioning}
                  style={{ fontSize: "14px", padding: "8px 16px" }}
                >
                  {transitioning ? "Retrying..." : "Try Again"}
                </button>
              )}
            </div>
          )}
        </section>
        </div>
      )}
      <WalletModal
        open={walletModalOpen}
        onClose={() => setWalletModalOpen(false)}
        qrCodeUrl={session.qr_code_url}
        qrCodeUrlAndroid={session.qr_code_url_android}
        walletPassUrl={session.wallet_pass_url ?? walletUrl}
        memberId={memberId}
      />
    </div>
  )
}

