/**
 * EnrollmentAdapter - Interface for enrollment operations
 * 
 * Both real HP adapter and mock adapter implement this interface.
 * UI components never know which adapter is being used.
 * 
 * ⚠️ CRITICAL RULE: Adapters are the ONLY place allowed to:
 *   - Call enrollment APIs (CreateLead, SetPlan, SetupPending, Enroll)
 *   - Mutate enrollment step (quote → details → payment → confirm)
 * 
 * ❌ FORBIDDEN: Direct navigation or step mutation outside adapters
 *   // DON'T DO THIS:
 *   // navigate("/payment");
 *   // updateSessionStep(sessionId, "payment");
 * 
 * ✅ REQUIRED: All step transitions must go through adapter methods
 *   // DO THIS:
 *   // const result = await adapter.setPlan(input);
 *   // if (result.step === "details") { navigate to details }
 * 
 * This rule prevents flows from breaking when contributors add "quick fixes"
 * that bypass the state-driven transition system.
 */

export type EnrollmentStep = "quote" | "details" | "payment" | "confirm"

export type EnrollmentResult = {
  step: EnrollmentStep
  leadId?: string
  quoteDetailId?: string
  planId?: string
  accountId?: string
  monthlyTotalPayment?: number // From setupPending response, used for enroll authorizedAmount
  error?: string
  [key: string]: unknown
}

export interface EnrollmentAdapter {
  /**
   * CreateLead - Step 1: Create enrollment lead
   * Returns result with step="quote" and leadId, quoteDetailId, planId
   */
  createLead(input: CreateLeadInput): Promise<EnrollmentResult>

  /**
   * SetPlan - Step 2: Set selected plan
   * Requires: quoteDetailId, planId
   * Returns result with step="details"
   */
  setPlan(input: SetPlanInput): Promise<EnrollmentResult>

  /**
   * SetupPending - Step 3: Setup pending account
   * Requires: leadId, acceptElectronicConsent, pets with deductible/reimbursement
   * Returns result with step="payment" and accountId
   */
  setupPending(input: SetupPendingInput): Promise<EnrollmentResult>

  /**
   * Enroll - Step 4: Complete enrollment
   * Requires: lead object, paymentDetails with transactionId/paymentToken
   * Returns result with step="confirm"
   */
  enroll(input: EnrollInput): Promise<EnrollmentResult>
}

export type CreateLeadInput = {
  zipCode: string
  stateCode?: string // Optional - backend can derive from zipCode
  pets: Array<{
    name: string
    speciesType: "DOG" | "CAT"
    breedType: string
    dateOfBirth: string
    genderType: "MALE" | "FEMALE"
  }>
  email: string
  firstName?: string
  lastName?: string
  phoneNumber?: string
  campaign?: string
  affiliateCode?: string
}

export type SetPlanInput = {
  emailAddress: string
  affiliateCode: string
  zipCode: string
  quoteDetailId: string
  planId: string
}

export type SetupPendingInput = {
  lead: {
    emailAddress: string
    affiliateCode: string
    zipCode: string
    stateCode: string
    firstName: string
    lastName: string
    mailingStreet: string
    phone: string
    leadId: string
  }
  pets: Array<{
    name: string
    speciesType: "DOG" | "CAT"
    breedType: string
    dateOfBirth: string
    genderType: "MALE" | "FEMALE"
    deductible: number
    reimbursement: number
  }>
  acceptElectronicConsent: boolean
}

export type EnrollInput = {
  lead: {
    emailAddress: string
    affiliateCode: string
    zipCode: string
    stateCode: string
    firstName: string
    lastName: string
    mailingStreet: string
    phone: string
    acceptElectronicConsent: boolean
    leadId: string
  }
  paymentDetails: {
    transactionId: string
    paymentToken: string
    authorizedAmount: number
    billingFirstName: string
    billingLastName: string
    billingStreet: string
    billingCity: string
    billingState: string
    billingPostalCode: string
    paymentMethod: "CreditCard" | "ECheck"
    convenienceFee?: number
  }
}
