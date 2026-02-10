/**
 * MockEnrollmentAdapter - Mock adapter for demos/testing
 * 
 * Returns realistic EnrollmentResult transitions.
 * Respects the same step ordering as HP: createLead → quote, setPlan → details, setupPending → payment, enroll → confirm
 * 
 * Does NOT skip steps or auto-advance UI.
 * 
 * ⚠️ ADAPTER BOUNDARY: This is the ONLY place that simulates enrollment API calls.
 * UI components must never bypass adapters, even in mock mode.
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

export class MockEnrollmentAdapter implements EnrollmentAdapter {
  private mockLeadId = `mock-lead-${Date.now()}`
  private mockQuoteDetailId = `mock-quote-${Date.now()}`
  private mockAccountId = `mock-account-${Date.now()}`

  async createLead(_input: CreateLeadInput): Promise<EnrollmentResult> {
    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 300))

    // Return realistic result with step="quote"
    return {
      step: "quote",
      leadId: this.mockLeadId,
      quoteDetailId: this.mockQuoteDetailId,
      planId: "70_500",
    }
  }

  async setPlan(input: SetPlanInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields (same as real adapter)
    if (!input.quoteDetailId || !input.planId) {
      throw new Error("SetPlan requires: quoteDetailId and planId (both are mandatory)")
    }

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 200))

    // Return result with step="details"
    return {
      step: "details",
      leadId: this.mockLeadId,
      quoteDetailId: input.quoteDetailId,
      planId: input.planId,
    }
  }

  async setupPending(input: SetupPendingInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields (same as real adapter)
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
    }

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 400))

    // Return result with step="payment" and accountId
    return {
      step: "payment",
      leadId: input.lead.leadId,
      accountId: this.mockAccountId,
    }
  }

  async enroll(input: EnrollInput): Promise<EnrollmentResult> {
    // Guardrail: Validate required fields (same as real adapter)
    if (!input.paymentDetails.transactionId || !input.paymentDetails.paymentToken) {
      throw new Error("Enroll requires: paymentDetails.transactionId and paymentDetails.paymentToken")
    }
    if (!input.lead.leadId) {
      throw new Error("Enroll requires: lead.leadId")
    }

    // Simulate API delay
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Return result with step="confirm"
    return {
      step: "confirm",
      leadId: input.lead.leadId,
      accountId: this.mockAccountId,
      registrationRedirectUrl: "https://example.com/confirmation",
    }
  }
}
