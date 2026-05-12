# PetRx Enrollment Flow - Current State Snapshot

**Generated:** 2026-02-10
**Last refreshed:** 2026-05-12 (HP SetupPending alignment: quoteDetailId per plan, DOB parity, SetPlan resync)
**Repo:** `@PetRx/app.petrxbyflex.com/`
**Purpose:** Document the quote → details → payment → confirm flow (reference for engineers; code is source of truth)

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
    - Each `insurance_products[]` row includes **`quote_detail_id`** for that HP quote line (same row as `plan_id`). The session column `quote_detail_id` remains a convenience default (first line); **SetPlan must use the id for the row the shopper selected.**
  - **SetPlan** (on "Continue to Details"): `POST /api/enrollment/set-plan`
    - Called by: `CardAndQuoteFlow.handleCtaClick()` → `enrollmentAdapter.setPlan()`
    - Uses **`quoteDetailId`** resolved from the selected plan row (`quote_detail_id` on the matching `insurance_products` entry, fallback to session `quote_detail_id`).
    - Updates: Session step to `"details"` via `updateSessionStep()`, including **`quote_detail_id`** on the PATCH so the DB matches the selected line.
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
    - **Before** SetupPending: **`setPlan` is called again** with the details-form **email**, **zip**, **`quoteDetailId` for the selected plan**, and **`plan_id`** so HP’s lead/plan state matches what we send on setup (avoids upstream 500 → our 502 when the user edits email/zip on details).
    - **Pet `dateOfBirth`:** Computed the **same way as CreateLead** in `LeadLoadingContext`: if `birth_month` + `birth_year` exist, use `YYYY-MM-01` (or `YYYY-01-01` if year only); otherwise use `pet.date_of_birth`. Preferring a full `date_of_birth` when month/year exist **diverged from CreateLead** and caused HP `setuppendingaccount` failures.
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
  - **OneInc Session** (auto on mount): `POST /api/oneinc/session`
    - Called by: `OneIncModalLauncher.initializeModal()` (no Add-payment-method button — modal auto-opens)
    - Selects V1 vs V2 wire format from `ONEINC_MODAL_VERSION` / `modalVersion` hint; returns `{ sessionId, environment, expiresAt, modalVersion }`.
  - **OneInc Complete** (on `paymentComplete`): `POST /api/oneinc/complete`
    - Called by: `OneIncModalLauncher.finalizePaymentSuccess()`
    - Durably persists the OneInc result on the enrollment session; the full response body is stringified into `paymentDetails.fullPaymentResponse` on the next HP Enroll call.
  - **Enroll** (auto-advance after `complete`): `POST /api/enrollment/enroll`
    - Called by: `CardAndQuoteFlow.handleCtaClick()` → `enrollmentAdapter.enroll()`
    - Reads `paymentResult` from `OneIncModalLauncher.onPaymentSuccess`.
    - Updates: Session step to `"confirm"` via `updateSessionStep()`. While pending, the UI shows a "Submitting…" indicator and auto-reconciles at 15s/45s/90s (`reconcile: true`) plus a 5s `/enroll-status` poll backstop.
- **Payment Data:** From `OneIncModalLauncher.onPaymentSuccess()`:
  - `paymentToken`, `transactionId`, `paymentMethod` ("CreditCard" | "ECheck"), `convenienceFee`, `oneIncCompleteResponse`
- **Cancel path:** If the user closes OneInc without paying, the launcher shows "Reopen Payment", which mints a fresh SessionKey via `/api/oneinc/session`.

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
| `src/components/insurance/OneIncModalLauncher.tsx` | **OneInc payment launcher** | `OneIncModalLauncher()` - auto-creates PortalOne session, mounts `PortalOneModal`, finalizes via `POST /api/oneinc/complete`, handles close → "Reopen Payment" |
| `src/components/insurance/PortalOneModal.tsx` | **PortalOne SDK shell** | Branches on `VITE_ONEINC_MODAL_VERSION`. V2 embeds `public/oneinc-frame.html` as a transparent full-viewport iframe (HP-style isolation). V1 loads PortalOne.js directly in the host document. |
| `public/oneinc-frame.html` | **V2 iframe host page** | Loads `GenericModalV2/PortalOne.js`, calls `makePayment`, bridges native CustomEvents (`portalOne.load`/`unload`/`paymentComplete`/`error`) back to the parent via `postMessage`. |
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

### ✅ Resolved (formerly "Critical Missing Pieces")

1. **OneInc SDK Integration** — resolved 2026-04 → 2026-05-11.
   - PortalOne.js SDK is integrated end-to-end. V2 (`GenericModalV2`) is the active staging path; V1 (`GenericModal`) is still wired as a fallback behind `VITE_ONEINC_MODAL_VERSION`.
   - V2 runs inside an isolated iframe (`public/oneinc-frame.html`) that mirrors HP's `/Enrollment/PaymentPage` pattern — OneInc's Angular CDK overlay lives inside that iframe's document, eliminating CSS conflicts with the host React app.
   - On `portalOne.paymentComplete`, the launcher POSTs the result to `/api/oneinc/complete` for durable persistence, then `CardAndQuoteFlow` auto-advances into HP Enroll.
   - Close → "Reopen Payment" works as of commit `03e831a` (bundle `index-CbuQeKd5.js`): V2 events are bound via native `addEventListener` (jQuery's `.on("portalOne.unload",...)` mis-treats the dot as a namespace), and the launcher's auto-start effect now depends on `closedWithoutPayment` so Reopen mints a fresh session.

2. **Convenience Fee** — resolved 2026-05-04.
   - Backend resolution priority: (1) fee extracted from `paymentDetails.fullPaymentResponse`, (2) explicit OneInc/client-supplied fee, (3) program 2.99% percent-of-authorized-amount fallback for CreditCard. ECheck uses `HP_ECHECK_CONVENIENCE_FEE`.
   - Frontend mirrors the priority (`extractConvenienceFeeFromPortalOne` → session-persisted → 2.99% fallback) and forwards `convenienceFee` to HP on Enroll.

3. **Payment Method Detection** — resolved.
   - V1's `paymentComplete` payload exposes `paymentCategory` and `paymentMethod`; V2 returns the same fields shaped under `detail`. `PortalOneModal.flattenPaymentCompletePayload` handles the documented nesting variants, and the launcher maps `paymentMethod === "ECheck"` vs `"CreditCard"` explicitly.

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
  quoteDetailId: string,  // Must match the selected plan’s HP quote line (see insurance_products[].quote_detail_id)
  planId: string  // From HP policies (selectedPlanIdFromHP)
}
```

### SetupPending (`POST /api/enrollment/setup-pending`)
```typescript
{
  session_id?: string,  // Optional; backend may persist accountId / amount on session
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
    acceptTermsAndConditionsConsent: true,  // Required by 2026 HP docs; adapter sends true
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
- **Quote → Details:** `adapter.setPlan()` → `updateSessionStep("details")` (PATCH includes `quote_detail_id` for the selected plan row)
- **Details → Payment:** `adapter.setPlan()` (resync) → `adapter.setupPending()` → `updateSessionStep("payment")`
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

### Current Implementation (PortalOne.js SDK)

**The "hosted modal URL" approach described in earlier revisions of this doc is dead.** Both the V1 and V2 paths now use the PortalOne.js SDK directly. `POST /api/oneinc/init` and `GET /api/oneinc/return` are still in the codebase but are not on the active flow and can be retired alongside the V1 cleanup.

- **Components:** `PaymentStep` → `OneIncModalLauncher` → `PortalOneModal`
- **Props passed to the launcher:**
  - `leadId`: HP leadId from CreateLead (forwarded to OneInc as `clientReferenceData1` and threaded into the V2 iframe via URL param)
  - `accountId`: HP accountId from SetupPending (carried for audit; V2 does not require a CustomerId on the SessionKey)
  - `amount`: `authorizedAmount` from SetupPending (used for `minAmountDue` / `accountBalance` in `makePayment`)
  - `enrollmentSessionId`: PetRx enrollment session UUID — used by `POST /api/oneinc/complete` for durable persistence

### SDK Path Selection (V1 vs V2)

Controlled by `VITE_ONEINC_MODAL_VERSION` (frontend build-arg) mirrored by `ONEINC_MODAL_VERSION` (backend env). Staging is on `v2` as of 2026-05-11; production is still on `legacy` pending cutover.

| | Legacy (v1) | V2 (active in staging) |
|--|--|--|
| Frontend SDK URL | `…/GenericModal/Cdn/PortalOne.js` | `…/GenericModalV2/PortalOne.js` |
| Where the SDK loads | Directly in the host React document | Inside an isolated iframe (`public/oneinc-frame.html`) |
| Backend session endpoint | `POST /GenericModal/SessionKey/Create` (form-encoded) | `GET /Api/Api/Session/Create?PortalOneAuthenticationKey=...` |
| SessionKey field | `SessionKey` (flat UUID) | `PortalOneSessionKey` (base64 / JWT-like blob) |
| `feeContext` enum | `0` (integer) | `"PaymentWithFee"` (string) |
| Event delivery | jQuery `.trigger("portalOne.…")` (catchable with `.on`) | Native `CustomEvent("portalOne.…")` — must use `addEventListener` |

The two wire formats are **not** interchangeable. The most consequential gotcha: V2's SDK validates that the SessionKey is the V2 base64 blob — feeding it a v1 UUID returns 401 at `gm2template/getportalconfiguration` and surfaces as a misleading `Failed to execute 'atob' on 'Window'` in the console. That was the actual root cause of the 401s we previously misattributed to a tenant origin allowlist (see `flex-pet-rx-api/docs/ONEINC_INTEGRATION.md`, 2026-05-11 entry).

### V2 Iframe-Isolation Pattern

`PortalOneModal.tsx` (V2 branch) renders two React portals into `document.body`:

1. A full-page dim div at `z-index: 9000`.
2. A transparent full-viewport `<iframe src="/oneinc-frame.html?sessionId=...&amount=...&leadId=...&returnUrl=...">` at `z-index: 9001`.

`public/oneinc-frame.html` loads jQuery + V2 PortalOne.js, calls `instance.makePayment(...)` with the V2-shape payload, and bridges OneInc events back to the parent via `postMessage`:

```
{ source: "petrx-oneinc-frame", action: "ready" }
{ source: "petrx-oneinc-frame", action: "loadComplete" }
{ source: "petrx-oneinc-frame", action: "paymentComplete", data: {...} }
{ source: "petrx-oneinc-frame", action: "unload", paymentCompleted: boolean }
{ source: "petrx-oneinc-frame", action: "error", message: string }
```

All V2 events are bound via native `addEventListener` on `#portalOneContainer`. jQuery `.on("portalOne.unload", ...)` interprets the dot as a namespace separator and silently drops V2's native `CustomEvent("portalOne.unload")`. jQuery `.on()` bindings are kept as a fallback for V1 emissions only.

### Success and Failure Paths

- **`paymentComplete` →** `OneIncModalLauncher.finalizePaymentSuccess` POSTs `{ session_id, paymentToken, transactionId, paymentMethod, status: "Approved", raw: {...} }` to `/api/oneinc/complete`. The full response is stored on the result as `oneIncCompleteResponse` and `JSON.stringify`'d into `paymentDetails.fullPaymentResponse` on the HP Enroll call.
- **`unload` (no paymentComplete) →** `PortalOneModal.onClose` fires, the launcher tears down the current `sessionId`, and surfaces a "Payment was canceled — Reopen Payment" button. Clicking it resets state, retriggers the auto-start `useEffect` (via `closedWithoutPayment` in its deps as of 2026-05-11), and mints a fresh SessionKey.
- **`error` →** same teardown plus the error message routed through `onPaymentError`.

### Payment Result Shape (passed to `onPaymentSuccess`)

```typescript
{
  paymentToken: string,           // OneInc vault token
  transactionId: string,          // OneInc transaction id
  paymentMethod: "CreditCard" | "ECheck",
  convenienceFee?: number,        // extracted from portalOne payload
  resolvedConvenienceFee?: number,// after backend fee-priority resolution
  feeDiagnostics?: {...},
  cardType?: string,
  authCode?: string,
  holderZip?: string,
  rawPortalOne?: object,          // sanitized for audit
  oneIncCompleteResponse?: object // full /api/oneinc/complete body — stringified into paymentDetails.fullPaymentResponse on Enroll
}
```

### Backend Endpoints

- **`POST /api/oneinc/session`** — creates the SessionKey server-side. Selects V1 vs V2 wire format from `ONEINC_MODAL_VERSION` (or `modalVersion` in the request body). Returns `{ sessionId, environment, expiresAt, modalVersion }`. `ONEINC_AUTH_KEY` never reaches the browser.
- **`POST /api/oneinc/complete`** — durably persists the OneInc result on the enrollment session before HP Enroll is called. Idempotent on `(session_id, transactionId)`.
- **`POST /api/oneinc/init`** (legacy, hosted-modal-URL) — kept in the codebase but not on the active path. Do not wire new callers to it.
- **`GET /api/oneinc/return`** (legacy, hosted-modal returnUrl) — same status; will be removed alongside `init` when V1 is retired.

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
