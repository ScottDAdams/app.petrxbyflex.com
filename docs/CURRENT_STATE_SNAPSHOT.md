# PetRx Enrollment Flow - Current State Snapshot

**Generated:** 2026-02-10  
**Repo:** `@PetRx/app.petrxbyflex.com/`  
**Purpose:** Document the quote → details → payment → confirm flow WITHOUT making code changes

---

## A) Flow Map

### Step Progression Overview
```
quote → details → payment → confirm
```

### Step-by-Step Flow

#### **Step 1: Quote (`quote`)**
- **Component:** `QuoteStep` (`src/app/steps/QuoteStep.tsx`)
- **Router:** `CardAndQuoteFlow.tsx` → `renderStepBody()` → `case "quote"`
- **Step Source:** `session.current_step` (from DB) OR `mockStep` (from URL `?mock=quote`)
- **API Calls:**
  - **CreateLead** (if `lead_id`/`quote_detail_id` missing): `POST /api/enrollment/lead`
    - Called by: `LeadLoadingContext` (automatic on mount)
    - Stores: `lead_id`, `quote_detail_id`, `insurance_products[]` in session
  - **SetPlan** (on "Continue to Details"): `POST /api/enrollment/set-plan`
    - Called by: `CardAndQuoteFlow.handleCtaClick()` → `enrollmentAdapter.setPlan()`
    - Updates: Session step to `"details"` via `updateSessionStep()`
- **State Management:**
  - Plans sourced from: `session.insurance_products[]` → `processInsuranceProducts()` → `ProcessedPlans`
  - Selected plan stored in: `selectedPlanIdFromHP` (state) + `selectedReimbursement` + `selectedDeductible`
  - Plan validation: Triple-check against HP policies (reimbursement, deductible, `isHighDeductible`)

#### **Step 2: Details (`details`)**
- **Component:** `DetailsStep` (`src/app/steps/DetailsStep.tsx`)
- **Router:** `CardAndQuoteFlow.tsx` → `renderStepBody()` → `case "details"`
- **Step Source:** `session.current_step` OR `mockStep`
- **API Calls:**
  - **SetupPending** (on "Continue to Payment"): `POST /api/enrollment/setup-pending`
    - Called by: `CardAndQuoteFlow.handleCtaClick()` → `enrollmentAdapter.setupPending()`
    - Returns: `accountId`, `monthlyTotalPayment` (stored in `authorizedAmount` state)
    - Updates: Session step to `"payment"` via `updateSessionStep()`
- **Form Data:** Collected via `DetailsStep.onContinue(formData)` → stored in `detailsFormData` state
- **Validation:** Phone (10 digits), required fields (firstName, lastName, email, phone, street, state)

#### **Step 3: Payment (`payment`)**
- **Component:** `PaymentStep` (`src/app/steps/PaymentStep.tsx`)
- **Router:** `CardAndQuoteFlow.tsx` → `renderStepBody()` → `case "payment"`
- **Step Source:** `session.current_step` OR `mockStep`
- **API Calls:**
  - **OneInc Init** (on "Add payment method"): `POST /api/oneinc/init`
    - Called by: `OneIncModalLauncher.initializeModal()`
    - **STATUS:** Placeholder - throws error "OneInc modal SDK integration required"
  - **Enroll** (on "Review & Confirm"): `POST /api/enrollment/enroll`
    - Called by: `CardAndQuoteFlow.handleCtaClick()` → `enrollmentAdapter.enroll()`
    - Requires: `paymentResult` from OneInc (currently not available)
    - Updates: Session step to `"confirm"` via `updateSessionStep()`
- **Payment Data:** Expected from `OneIncModalLauncher.onPaymentSuccess()`:
  - `paymentToken`, `transactionId`, `paymentMethod` ("CreditCard" | "ECheck")
- **Missing:** OneInc SDK integration (see PaymentStep section)

#### **Step 4: Confirm (`confirm`)**
- **Component:** `ConfirmStep` (`src/app/steps/ConfirmStep.tsx`)
- **Router:** `CardAndQuoteFlow.tsx` → `renderStepBody()` → `case "confirm"`
- **Step Source:** `session.current_step` OR `mockStep`
- **API Calls:** None (display only)
- **Data Displayed:** From session: `policy_number`, `effective_date`, plan details

---

## B) Key Files

| Path | Purpose | Key Functions |
|------|---------|---------------|
| `src/components/CardAndQuoteFlow.tsx` | **Main flow orchestrator** | `handleCtaClick()`, `renderStepBody()`, `processInsuranceProducts()`, `getEnrollmentAdapter()` |
| `src/app/steps/QuoteStep.tsx` | Quote selection UI | `QuoteStep()` - renders plan selector, reimbursement/deductible options |
| `src/app/steps/DetailsStep.tsx` | Owner details form | `DetailsStep()` - collects firstName, lastName, email, phone, address |
| `src/app/steps/PaymentStep.tsx` | Payment form wrapper | `PaymentStep()` - renders `OneIncModalLauncher`, "Review & Confirm" button |
| `src/app/steps/ConfirmStep.tsx` | Confirmation screen | `ConfirmStep()` - displays policy summary |
| `src/components/insurance/EnrollmentAdapter.ts` | **Adapter interface** | Defines `EnrollmentAdapter` interface + input/output types |
| `src/components/insurance/HpEnrollmentAdapter.ts` | **Real HP API adapter** | `createLead()`, `setPlan()`, `setupPending()`, `enroll()` - calls backend endpoints |
| `src/components/insurance/MockEnrollmentAdapter.ts` | Mock adapter (dev) | Mock implementations for testing |
| `src/components/insurance/OneIncModalLauncher.tsx` | **OneInc payment modal** | `OneIncModalLauncher()` - **PLACEHOLDER** (throws error, SDK not integrated) |
| `src/context/LeadLoadingContext.tsx` | Auto-loads quotes | `LeadLoadingProvider` - calls `/api/enrollment/lead` when `lead_id`/`quote_detail_id` missing |
| `src/api/session.ts` | Session API client | `fetchSession()`, `updateSessionStep()`, `updateSessionInsuranceProducts()` |
| `src/api/index.ts` | API base URL | `API_BASE` - from `VITE_API_URL` env var (default: `https://api.petrxbyflex.com`) |
| `src/components/flowSteps.ts` | Step definitions | `FLOW_STEPS` - array of step IDs: `["quote", "details", "payment", "confirm"]` |
| `src/context/SessionContext.tsx` | Session state provider | `useSession()` - provides `session` object, `refetch()`, `setSession()` |

---

## C) What I Need to Share with ChatGPT

### Core Flow Files (Paste These)
1. **`src/components/CardAndQuoteFlow.tsx`** (833 lines)
   - Main orchestrator: step routing, API calls, state management
   - Key sections: `handleCtaClick()` (lines 241-599), `renderStepBody()` (lines 614-737)

2. **`src/app/steps/QuoteStep.tsx`** (268 lines)
   - Plan selection UI, reimbursement/deductible options
   - Key: `onSelectionChange()` callback updates `selectedPlanIdFromHP`

3. **`src/app/steps/PaymentStep.tsx`** (72 lines)
   - Payment step wrapper, OneInc integration point
   - Key: `onPaymentSuccess()` callback expects `{ paymentToken, transactionId, paymentMethod }`

4. **`src/components/insurance/EnrollmentAdapter.ts`** (143 lines)
   - Interface definitions: `EnrollmentAdapter`, `EnrollmentResult`, input types
   - Documents adapter boundary rule

5. **`src/components/insurance/HpEnrollmentAdapter.ts`** (270 lines)
   - Real API adapter implementation
   - All 4 enrollment API calls: `createLead`, `setPlan`, `setupPending`, `enroll`

6. **`src/components/insurance/OneIncModalLauncher.tsx`** (184 lines)
   - **CRITICAL:** Currently throws error - SDK integration needed
   - Placeholder structure with TODO comments

### Supporting Files (Reference)
- `src/app/steps/DetailsStep.tsx` - Form component
- `src/app/steps/ConfirmStep.tsx` - Confirmation screen
- `src/api/session.ts` - Session API client
- `src/context/LeadLoadingContext.tsx` - Auto-quote loading
- `src/components/flowSteps.ts` - Step definitions

---

## D) Open Questions / Risks

### 🔴 Critical Missing Pieces

1. **OneInc SDK Integration**
   - **File:** `src/components/insurance/OneIncModalLauncher.tsx`
   - **Status:** Throws error "OneInc modal SDK integration required"
   - **Missing:**
     - OneInc JavaScript SDK loading (`<script>` tag or npm package)
     - Modal initialization with `initData` from `/api/oneinc/init`
     - Success/error callback wiring
   - **Impact:** Payment step cannot complete without this

2. **Convenience Fee**
   - **Location:** `CardAndQuoteFlow.tsx:562`
   - **Status:** Hardcoded to `0` (placeholder comment: "needs actual fee")
   - **Missing:** Logic to get actual convenience fee from HP or OneInc response
   - **Impact:** May cause enrollment failures if HP requires accurate fee

3. **Payment Method Detection**
   - **Location:** `OneIncModalLauncher.tsx` (commented example)
   - **Status:** Assumes OneInc returns `paymentMethod` in success callback
   - **Missing:** Confirmation that OneInc SDK actually returns this field
   - **Impact:** May default incorrectly to "CreditCard" vs "ECheck"

### ⚠️ State Management Risks

4. **Race Condition: Form Data**
   - **Location:** `CardAndQuoteFlow.tsx:632-635`
   - **Risk:** `DetailsStep.onContinue()` passes `formData` directly to `handleCtaClick()` to avoid async state race
   - **Status:** Mitigated by passing data directly, but fragile

5. **Plan Selection Validation**
   - **Location:** `CardAndQuoteFlow.tsx:286-333`
   - **Risk:** Triple-validation (reimbursement, deductible, `isHighDeductible`) may fail if HP response format changes
   - **Status:** Defensive but complex

### 🔵 Backend Dependencies

6. **Backend Endpoints (Not in this repo)**
   - All enrollment APIs proxy through backend: `/api/enrollment/*`
   - Backend must implement:
     - `POST /api/enrollment/lead`
     - `POST /api/enrollment/set-plan`
     - `POST /api/enrollment/setup-pending`
     - `POST /api/enrollment/enroll`
     - `POST /api/oneinc/init`
   - **Missing:** Backend implementation details (likely in `flex-pet-rx-api` repo)

7. **Session Step Persistence**
   - **Location:** `src/api/session.ts:87-108`
   - **Status:** `updateSessionStep()` PATCHes `/enroll/session` with `current_step`
   - **Risk:** Backend must persist `current_step` to DB (unknown if implemented)

### 🟡 Environment Variables

8. **API Base URL**
   - **Location:** `src/api/index.ts`
   - **Env Var:** `VITE_API_URL` (defaults to `https://api.petrxbyflex.com`)
   - **Status:** Standard Vite env pattern
   - **Risk:** Must be set correctly in production

---

## E) API Request Payloads

### CreateLead (`POST /api/enrollment/lead`)
```typescript
{
  affiliateCode: "FLEXEMBD",
  zipCode: string,
  stateCode?: string,  // Optional
  pets: Array<{
    name: string,
    speciesType: "DOG" | "CAT",
    breedType: string,  // breed_id as string
    dateOfBirth: string,  // YYYY-MM-DD
    genderType: "MALE" | "FEMALE"
  }>,
  attributionMetadata: {
    email: string,
    firstName?: string,
    lastName?: string,
    phoneNumber?: string
  },
  campaign?: string
}
```

### SetPlan (`POST /api/enrollment/set-plan`)
```typescript
{
  emailAddress: string,
  affiliateCode: "FLEXEMBD",
  zipCode: string,
  quoteDetailId: string,  // From CreateLead response
  planId: string  // From HP policies (selectedPlanIdFromHP)
}
```

### SetupPending (`POST /api/enrollment/setup-pending`)
```typescript
{
  lead: {
    emailAddress: string,
    affiliateCode: "FLEXEMBD",
    zipCode: string,
    stateCode: string,
    firstName: string,
    lastName: string,
    mailingStreet: string,
    phone: string,  // Normalized: 10 digits, optionally hyphenated
    acceptElectronicConsent: true,
    leadId: string
  },
  pets: Array<{
    name: string,
    speciesType: "DOG" | "CAT",
    breedType: string,
    dateOfBirth: string,  // YYYY-MM-DD (required, validated)
    genderType: "MALE" | "FEMALE",
    deductible: number,  // e.g., 500
    reimbursement: number  // e.g., 80 (percentage)
  }>
}
```

### Enroll (`POST /api/enrollment/enroll`)
```typescript
{
  lead: {
    emailAddress: string,
    affiliateCode: "FLEXEMBD",
    zipCode: string,
    stateCode: string,
    firstName: string,
    lastName: string,
    mailingStreet: string,
    phone: string,
    acceptElectronicConsent: true,
    leadId: string
  },
  paymentDetails: {
    transactionId: string,  // From OneInc
    paymentToken: string,  // From OneInc
    authorizedAmount: number,  // From setupPending.monthlyTotalPayment
    billingFirstName: string,
    billingLastName: string,
    billingStreet: string,
    billingCity: string,
    billingState: string,
    billingPostalCode: string,
    paymentMethod: "CreditCard" | "ECheck",  // From OneInc
    convenienceFee: number  // Currently 0 (placeholder)
  }
}
```

### OneInc Init (`POST /api/oneinc/init`)
```typescript
{
  customerId?: string,  // session.member_id
  amount?: number,  // authorizedAmount from setupPending
  billingZip?: string  // From detailsFormData or session
}
```

---

## F) Step Transition Logic

### Step Determination
```typescript
const effectiveStep = (mockStep ?? session.current_step ?? "quote").toLowerCase()
```

**Priority:**
1. `mockStep` (from URL `?mock=quote|details|payment|confirm`)
2. `session.current_step` (from DB via `GET /enroll/session`)
3. Default: `"quote"`

### Step Transitions (State-Driven)
- **Quote → Details:** `adapter.setPlan()` → `updateSessionStep("details")`
- **Details → Payment:** `adapter.setupPending()` → `updateSessionStep("payment")`
- **Payment → Confirm:** `adapter.enroll()` → `updateSessionStep("confirm")`

**Rule:** All transitions go through adapter methods. UI never directly mutates step.

---

## G) Plan Selection Flow

### Plan Data Source
1. **HP API Response** → `session.insurance_products[]`
2. **Processing:** `processInsuranceProducts()` → `ProcessedPlans`
   - Extracts: `allReimbursements[]`, `allDeductibles[]`, `allPolicies[]`
   - Finds: `defaultPolicy` (checks `isDefaultPlan`, then 70%/500, then first)

### Plan Selection State
- **UI State:** `selectedPlanId` ("signature" | "value")
- **HP Plan ID:** `selectedPlanIdFromHP` (actual `plan_id` from HP)
- **Options:** `selectedReimbursement`, `selectedDeductible`

### Plan Validation (Triple-Check)
1. `plan_id` exists in `allPolicies[]`
2. `reimbursement` matches (as percentage string: "80")
3. `deductible` matches (as string: "500")
4. `isHighDeductible` matches plan type (`true` = Value, `false` = Signature)

**Location:** `CardAndQuoteFlow.tsx:286-333`

---

## H) Payment Integration Status

### Current Implementation (OneInc Hosted Modal)
- **Component:** `PaymentStep` renders `OneIncModalLauncher`
- **Props Passed:**
  - `leadId`: HP leadId from CreateLead (maps to OneInc customerId)
  - `accountId`: HP accountId from SetupPending (maps to OneInc policyId)
  - `amount`: `authorizedAmount` (from `setupPending`) or `monthlyPrice`

### OneInc Hosted Modal Flow
**We now use OneInc hosted modal URL, iframe dialog, returnUrl redirect success mechanism.**

Based on HAR analysis from `enroll.hptest.info`:
1. **OneInc Hosted Modal:** No JS SDK required. OneInc provides hosted modal URL:
   - Format: `https://stgportalone.processonepayments.com/GenericModalV2/start-with-parameters?...`
   - Parameters: `customerId` (leadId), `policyId` (accountId), `MerchantId` ("HP"), `Amount`, `returnUrl`, `referrer`
   - Modal establishes session/auth via cookies when loaded
   - Modal makes API calls internally:
     - `POST /gm2card/getconveniencefeeslist` (calculates convenience fee)
     - `POST /gm2card/charge` (processes payment)

2. **Frontend Implementation:**
   - `OneIncModalLauncher` opens OneInc hosted modal URL in iframe dialog overlay (not popup)
   - Iframe size: 520x720px, centered overlay with backdrop
   - User completes payment in iframe (all PCI-sensitive data handled by OneInc)

3. **Success Mechanism:**
   - OneInc redirects to `returnUrl` (`/api/oneinc/return`) with payment result:
     - `Token`: payment token for enrollment
     - `TransactionId`: transaction ID
     - `Status`: "Approved" or error status
     - `ConvenienceFee`: convenience fee amount (if CreditCard)
     - `AmountSubmitted`: total amount charged
   - Return handler (`oneinc-return.html`) sends `postMessage` to parent window
   - Parent window (`OneIncModalLauncher`) listens for message and extracts payment result
   - Modal closes automatically on success

4. **Payment Result:**
   - `paymentToken`: Token from OneInc response
   - `transactionId`: TransactionId from OneInc response
   - `paymentMethod`: "CreditCard" or "ECheck" (determined by ConvenienceFee > 0)
   - `convenienceFee`: ConvenienceFee from OneInc response (for CreditCard transactions)

5. **Enrollment Flow:**
   - User clicks "Continue to payment" → opens iframe modal
   - User completes payment → OneInc redirects to returnUrl → postMessage → modal closes
   - `PaymentStep` stores result in `paymentResult` state
   - User clicks "Review & Confirm"
   - `handleCtaClick()` calls `adapter.enroll()` with payment details including `convenienceFee`

### Backend Implementation
- **`POST /api/oneinc/init`**: Returns OneInc hosted modal URL with correct parameters
  - Maps HP `leadId` → OneInc `customerId`
  - Maps HP `accountId` → OneInc `policyId`
  - Sets `MerchantId` = "HP" (constant)
  - Includes `returnUrl` pointing to `/api/oneinc/return`
- **`GET /api/oneinc/return`**: Handles OneInc redirect after payment
  - Extracts Token, TransactionId, ConvenienceFee from URL params
  - Renders HTML page that sends postMessage to parent window
  - Validates payment status ("Approved")

### TODO / Needs Confirmation
- **agentId parameter:** HAR shows `agentId` in OneInc requests. Need to confirm:
  - Is it in SetupPending response?
  - Is it a constant value?
  - Check OneInc-Payment-Integration-Documentation.pdf for exact parameter names
- **Exact parameter names:** Confirm from OneInc docs (may differ from HAR observation)
- **Error handling:** Confirm how OneInc communicates errors (Status field or separate error params)

---

## I) Session Data Shape

### Session Object (from `GET /enroll/session`)
```typescript
{
  session_id: string,
  current_step?: string,  // "quote" | "details" | "payment" | "confirm"
  funnel_type?: string,
  card_image_url?: string,
  wallet_url?: string,
  wallet_pass_url?: string,
  qr_code_url?: string,
  qr_code_url_android?: string,
  insurance_products?: Array<{
    deductible: number,
    reimbursement: number,  // 0.7, 0.8, etc.
    monthly_premium: string,  // "34.99"
    plan_id: string,  // HP plan ID
    isDefaultPlan?: boolean,
    isHighDeductible?: boolean
  }>,
  lead_id?: string | null,
  quote_detail_id?: string | null,
  pet?: {
    name?: string,
    type?: "dog" | "cat",
    sex?: string,
    breed_id?: number,
    breed_label?: string,
    birth_month?: number,
    birth_year?: number,
    zip_code?: string
  },
  owner?: {
    first_name?: string,
    last_name?: string,
    email?: string
  },
  member_id?: string,  // For OneInc customerId
  policy_number?: string,  // After enrollment
  effective_date?: string  // After enrollment
}
```

---

## J) Mock Mode

### Activation
- URL parameter: `?mock=quote|details|payment|confirm`
- Function: `getMockStep()` from `src/mocks/mockMode.ts`

### Behavior
- Skips API calls
- Uses query param navigation (`setSearchParams`)
- Shows mock data from `src/mocks/sessions.ts`

---

## K) Error Handling

### Transition Errors
- **State:** `transitionError` (string | null)
- **Display:** Shows below step content (conditional on `effectiveStep`)
- **Timeout Handling:** `isTimeoutError` flag (for SetupPending retries)

### Validation Errors
- **Quote:** Plan selection validation (lines 286-333)
- **Details:** Form field validation (lines 384-450)
- **Payment:** Payment result validation (lines 516-521)

---

## Summary Checklist for ChatGPT

✅ **Files to paste:**
- `CardAndQuoteFlow.tsx` (full file)
- `QuoteStep.tsx` (full file)
- `PaymentStep.tsx` (full file)
- `EnrollmentAdapter.ts` (full file)
- `HpEnrollmentAdapter.ts` (full file)
- `OneIncModalLauncher.tsx` (full file)

✅ **Key information:**
- Step routing: `session.current_step` → `renderStepBody()` switch
- API calls: All via adapters (boundary rule enforced)
- Payment integration: OneInc SDK needed (placeholder exists)
- Plan selection: Triple-validation against HP policies
- Session persistence: `updateSessionStep()` PATCHes backend

❌ **Missing (cannot determine from code):**
- Backend implementation (`/api/enrollment/*` endpoints)
- OneInc SDK documentation/integration details
- Actual convenience fee calculation logic
- Production environment variable values
