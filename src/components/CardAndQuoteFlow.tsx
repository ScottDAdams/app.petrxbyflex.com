import * as React from "react"
import { useSearchParams } from "react-router-dom"
import { getMockStep, isMockModeEnabled } from "../mocks/mockMode"
import { useSession } from "../context/SessionContext"
import { updateSessionStep } from "../api/session"
import { CardDisplayPanel } from "./CardDisplayPanel"
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
  
  // Find default policy: first check for isDefaultPlan flag, then fallback to 70%/500, then first policy
  const defaultPolicy =
    allPolicies.find((p) => p.isDefaultPlan === true) ||
    allPolicies.find((p) => (p.reimbursement as number) === 0.7 && p.deductible === 500) ||
    allPolicies[0] ||
    null
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

  // Hydrate quote from DB when session has plan (source of truth). Fallback to default policy when no plan saved yet.
  const sessionPlan = (session as Record<string, unknown>)?.plan as { plan_id?: string; reimbursement?: string; deductible?: string; is_high_deductible?: boolean } | undefined
  React.useEffect(() => {
    if (sessionPlan?.plan_id != null) {
      setSelectedPlanIdFromHP(sessionPlan.plan_id)
      if (sessionPlan.reimbursement != null) setSelectedReimbursement(String(sessionPlan.reimbursement))
      if (sessionPlan.deductible != null) setSelectedDeductible(String(sessionPlan.deductible))
      setSelectedPlanId(sessionPlan.is_high_deductible ? "value" : "signature")
      return
    }
    if (processedPlans.defaultPolicy) {
      const d = processedPlans.defaultPolicy
      const isHighDeductible = (d.isHighDeductible as boolean) ?? false
      const isSignature = !isHighDeductible
      setSelectedPlanId(isSignature ? "signature" : "value")
      const reimbursement = Math.round(((d.reimbursement as number) || 0.8) * 100).toString()
      const deductibleStr = String(d.deductible ?? (isSignature ? "500" : "1500"))
      setSelectedReimbursement(reimbursement)
      setSelectedDeductible(deductibleStr)
      setSelectedPlanIdFromHP((d.plan_id as string) ?? null)
    }
  }, [sessionPlan?.plan_id, sessionPlan?.reimbursement, sessionPlan?.deductible, sessionPlan?.is_high_deductible, processedPlans.defaultPolicy])

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

  return (
    <div className="card-and-quote-flow">
      <div className="card-and-quote-grid">
        <section className="card-panel">
          {effectiveStep === "quote" || effectiveStep === "confirm" ? (
            <>
              {cardImageUrl ? (
                <CardDisplayPanel
                  cardImageUrl={cardImageUrl}
                  walletUrl={walletUrl}
                  memberId={memberId}
                  petName={displayPetName}
                  onAddToWallet={() => setWalletModalOpen(true)}
                />
              ) : (
                <div className="cardPanel card-display-panel-empty">
                  <div className="cardPanel__header">
                    <h2>Your Digital Card</h2>
                  </div>
                  <p className="cardPanel__note">Card image will appear when available.</p>
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
    </div>
  )
}

