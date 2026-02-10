/**
 * HpEnrollmentAdapter - Real HP Enrollment API v5 adapter
 * 
 * Wraps the corrected Enrollment API v5 client.
 * Maps HP API responses to EnrollmentResult.
 * 
 * ⚠️ ADAPTER BOUNDARY: This is the ONLY place that calls HP Enrollment APIs.
 * UI components must never call enrollment APIs directly.
 * All enrollment operations must go through adapter methods.
 */

import type {
  EnrollmentAdapter,
  EnrollmentResult,
  CreateLeadInput,
  SetPlanInput,
  SetupPendingInput,
  EnrollInput,
} from "./EnrollmentAdapter"

import { API_BASE } from "../../api"

export class HpEnrollmentAdapter implements EnrollmentAdapter {
  async createLead(input: CreateLeadInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields
    if (!input.zipCode || !input.pets?.length || !input.email) {
      throw new Error("CreateLead requires: zipCode, pets[], email")
    }

    try {
      const response = await fetch(`${API_BASE}/api/enrollment/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateCode: input.affiliateCode || "FLEXEMBD",
          zipCode: input.zipCode,
          ...(input.stateCode && { stateCode: input.stateCode }),
          pets: input.pets.map((p) => ({
            name: p.name,
            speciesType: p.speciesType,
            breedType: p.breedType,
            dateOfBirth: p.dateOfBirth,
            genderType: p.genderType,
          })),
          attributionMetadata: {
            email: input.email,
            ...(input.firstName && { firstName: input.firstName }),
            ...(input.lastName && { lastName: input.lastName }),
            ...(input.phoneNumber && { phoneNumber: input.phoneNumber }),
          },
          ...(input.campaign && { campaign: input.campaign }),
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
        throw new Error(error.message || `CreateLead failed: ${response.status}`)
      }

      const data = await response.json()

      // Extract required values from HP response
      const leadId = data.leadId || data.lead_id
      const quotes = data.quotes || []
      let quoteDetailId: string | undefined
      let planId: string | undefined

      // Extract quoteDetailId from quotes[].pets[].quoteDetailId
      for (const quote of quotes) {
        const pets = quote.pets || []
        for (const pet of pets) {
          quoteDetailId = pet.quoteDetailId || pet.quote_detail_id
          if (quoteDetailId) break
        }
        if (quoteDetailId) break
      }

      planId = data.planId || data.plan_id

      return {
        step: "quote",
        leadId,
        quoteDetailId,
        planId,
      }
    } catch (error) {
      return {
        step: "quote",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async setPlan(input: SetPlanInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields (HP docs: affiliateCode, zipCode, emailAddress, quoteDetailId; sample also has planId)
    if (!input.quoteDetailId || !input.planId) {
      throw new Error("SetPlan requires: quoteDetailId and planId (both are mandatory)")
    }
    if (!input.emailAddress || !input.affiliateCode) {
      throw new Error("SetPlan requires: emailAddress and affiliateCode")
    }
    if (!input.zipCode) {
      throw new Error("SetPlan requires: zipCode")
    }

    try {
      const response = await fetch(`${API_BASE}/api/enrollment/set-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAddress: input.emailAddress,
          affiliateCode: input.affiliateCode,
          zipCode: input.zipCode,
          quoteDetailId: input.quoteDetailId,
          planId: input.planId,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
        throw new Error(error.message || `SetPlan failed: ${response.status}`)
      }

      // Response validated but not needed for SetPlan result
      await response.json()

      return {
        step: "details",
        planId: input.planId,
      }
    } catch (error) {
      return {
        step: "quote",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async setupPending(input: SetupPendingInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields
    if (!input.acceptElectronicConsent) {
      throw new Error("SetupPending requires: acceptElectronicConsent=true (explicit consent required)")
    }
    if (!input.lead.leadId) {
      throw new Error("SetupPending requires: lead.leadId")
    }
    if (!input.pets?.length) {
      throw new Error("SetupPending requires: pets[] array")
    }
    for (const pet of input.pets) {
      if (pet.deductible === undefined || pet.reimbursement === undefined) {
        throw new Error("SetupPending requires: pets[].deductible and pets[].reimbursement")
      }
      const dob = typeof pet.dateOfBirth === "string" ? pet.dateOfBirth.trim() : ""
      if (!dob || dob.length < 8) {
        console.error("[HpEnrollmentAdapter] Invalid dateOfBirth:", {
          dateOfBirth: pet.dateOfBirth,
          type: typeof pet.dateOfBirth,
          trimmed: dob,
          length: dob.length,
        })
        throw new Error(`SetupPending requires: pets[].dateOfBirth as YYYY-MM-DD (got: "${pet.dateOfBirth}")`)
      }
    }

    try {
      const response = await fetch(`${API_BASE}/api/enrollment/setup-pending`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: {
            emailAddress: input.lead.emailAddress,
            affiliateCode: input.lead.affiliateCode,
            zipCode: input.lead.zipCode,
            stateCode: input.lead.stateCode,
            firstName: input.lead.firstName,
            lastName: input.lead.lastName,
            mailingStreet: input.lead.mailingStreet,
            phone: input.lead.phone,
            acceptElectronicConsent: input.acceptElectronicConsent,
            leadId: input.lead.leadId,
          },
          pets: input.pets.map((p) => ({
            name: p.name,
            speciesType: p.speciesType,
            breedType: p.breedType,
            dateOfBirth: p.dateOfBirth,
            genderType: p.genderType,
            deductible: p.deductible,
            reimbursement: p.reimbursement,
          })),
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
        
        // Check for timeout error (504 Gateway Timeout)
        if (response.status === 504 || (error.error === "Upstream timeout" || error.message?.includes("too long"))) {
          const timeoutError = new Error(error.message || "HealthyPaws took too long to respond. Please try again.")
          ;(timeoutError as any).isTimeout = true
          ;(timeoutError as any).requestId = error.request_id
          throw timeoutError
        }
        
        throw new Error(error.message || `SetupPending failed: ${response.status}`)
      }

      const data = await response.json()

      // Extract accountInfo.accountObject.id (Pending) and monthlyTotalPayment
      const accountInfo = data.accountInfo || {}
      const accountObject = accountInfo.accountObject || {}
      const accountId = accountObject.id
      const monthlyTotalPayment = typeof accountInfo.monthlyTotalPayment === "number"
        ? accountInfo.monthlyTotalPayment
        : undefined

      return {
        step: "payment",
        accountId,
        monthlyTotalPayment, // Return for use in enroll call
      }
    } catch (error) {
      return {
        step: "details",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async enroll(input: EnrollInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields
    if (!input.paymentDetails.transactionId || !input.paymentDetails.paymentToken) {
      throw new Error("Enroll requires: paymentDetails.transactionId and paymentDetails.paymentToken")
    }
    if (!input.lead.leadId) {
      throw new Error("Enroll requires: lead.leadId")
    }

    try {
      const response = await fetch(`${API_BASE}/api/enrollment/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead: input.lead,
          paymentDetails: input.paymentDetails,
        }),
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: `HTTP ${response.status}` }))
        throw new Error(error.message || `Enroll failed: ${response.status}`)
      }

      const data = await response.json()

      return {
        step: "confirm",
        registrationRedirectUrl: data.registrationRedirectUrl || data.registration_redirect_url,
      }
    } catch (error) {
      return {
        step: "payment",
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
