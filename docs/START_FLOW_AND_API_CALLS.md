# /start flow: process, API calls, and issues

## When you land on `/start?session_id=...`

Entry is only via this URL (e.g. redirect from Framer). `session_id` is required unless mock mode is on.

---

## 1. Initial load

### 1.1 Route and session ID

- **Route:** `Start` renders; `SessionProviderFromUrl` reads `session_id` from `?session_id=...`.
- **SessionProvider** runs `load()` in a `useEffect` because `sessionId` is set.

### 1.2 Call 1: GET session

| What | Details |
|------|---------|
| **Call** | `GET https://api.petrxbyflex.com/enroll/session?session_id={session_id}` |
| **Who** | `fetchSession(sessionId)` in `SessionContext` |
| **Returns** | Session: `session_id`, `member_id`, `card_image_url`, `wallet_url`, `current_step`, `insurance_products`, `pet`, `owner`, optional `lead_id`, `quote_detail_id` |

**Possible issues:**

- **404** → Session not found (bad id or not yet created). User sees "Session not found" or error from context.
- **Network error** → `state.status === "error"`, message shown.
- **Missing pet/owner** → Later steps (CreateLead, details) may fail or show “missing info” errors.

---

## 2. After session is ready (`state.status === "ready"`)

- **Start** renders **CardAndQuoteFlow**.
- **effectiveStep** = `session.current_step` (default `"quote"`).
- **products** = `session.insurance_products` (often `[]` on first load).

---

## 3. Quote step: automatic CreateLead (useEffect)

Runs only when:

- Not mock mode.
- `state.status === "ready"`.
- `effectiveStep === "quote"`.
- **No products** (`products.length === 0`), or products are detected as “all duplicates” (then we clear and re-fetch).
- No `enrollmentState.leadId` yet.

Session must have: `pet.zip_code`, `pet.name`, `pet.birth_month` or `pet.birth_year`, `owner.email`.

### 3.1 Call 2: POST CreateLead

| What | Details |
|------|---------|
| **Call** | `POST https://api.petrxbyflex.com/api/enrollment/lead` |
| **Body** | `affiliateCode`, `zipCode`, `pets[]` (name, speciesType, breedType, dateOfBirth, genderType), `attributionMetadata` (email, optional firstName, lastName, phoneNumber) |
| **Returns** | `leadId`, `quotes[]` (with `quoteDetailId` / `quote_detail_id`, planId, pricing, etc.) |

**Possible issues:**

- **400/4xx/5xx** → CreateLead fails; we log and return without updating UI; user may see “Insurance Quotes Coming Soon” or empty quote state.
- **Missing leadId or quoteDetailId in response** → We can’t set `enrollmentState` or persist ids; “Continue to Details” will later show “Quote data didn’t load correctly…”.
- **Empty or malformed `quotes`** → We may not get `quoteDetailId` or a sensible default plan; same downstream issue.

After success we:

- Set **enrollmentState**: `leadId`, `quoteDetailId`, `planId`.
- Transform **quotes** → **insurance_products** (deductible, reimbursement, monthly_premium, plan_id, isDefaultPlan).
- Call **Call 3** (below).

### 3.2 Call 3: PATCH session (products + lead ids)

| What | Details |
|------|---------|
| **Call** | `PATCH https://api.petrxbyflex.com/enroll/session` |
| **Body** | `session_id`, `insurance_products`, optional `lead_id`, `quote_detail_id` |
| **Purpose** | Save products and HP ids so “Continue to Details” can use only SetPlan and so refetch returns ids |

**Possible issues:**

- **Backend missing columns** → If migration `2026-02-05_enrollment_sessions_lead_quote_ids.sql` has not been run, backend may error on or ignore `lead_id`/`quote_detail_id`. Then GET session never returns them and we have no ids for “Continue to Details” → user sees “Quote data didn’t load correctly. Please refresh…”.
- **400/500** → Session not updated; products/ids not saved; refetch still has old session.

### 3.3 Call 4: GET session (refetch)

| What | Details |
|------|---------|
| **Call** | `GET https://api.petrxbyflex.com/enroll/session?session_id={session_id}` (same as Call 1) |
| **Who** | `refetch()` after PATCH |
| **Purpose** | Reload session so it includes `insurance_products` and, if backend supports it, `lead_id` and `quote_detail_id` |

**Possible issues:**

- If PATCH didn’t persist `lead_id`/`quote_detail_id` (e.g. migration not run), session still has no ids; we rely on **enrollmentState** being set in the same run. If that state is lost (e.g. remount), we have no ids.

---

## 4. Zip lookup (optional, for Your details)

When **detailsZip** (from `pet.zip_code` or `owner.zip_code`) is at least 5 digits:

### 4.1 Call 5: GET zip → city/state

| What | Details |
|------|---------|
| **Call** | `GET https://api.zippopotam.us/us/{zip}` (external) |
| **Who** | `useEffect` in CardAndQuoteFlow when `detailsZip` is set |
| **Returns** | `places[0].place name` (city), `places[0].state abbreviation` (state code) |
| **Purpose** | Pre-fill city/state on “Your details” from zip |

**Possible issues:**

- **CORS** → Browser may block the request; city/state stay empty (user can still type them).
- **Network/4xx/5xx** → Same; no pre-fill.

---

## 5. User clicks “Continue to Details” (quote → details)

We need **leadId** and **quoteDetailId** from:

1. **enrollmentState** (set when CreateLead succeeded in this page load), or  
2. **session** (`session.lead_id`, `session.quote_detail_id` after refetch, if backend stores them).

If either is missing we show:

- “Quote data didn’t load correctly. Please refresh the page to load your quote again.” (when we already have products), or  
- “Please wait for your quote to load, then click Continue to Details.” (when we don’t have products yet).

If we have both ids:

### 5.1 Call 6: POST SetPlan

| What | Details |
|------|---------|
| **Call** | `POST https://api.petrxbyflex.com/api/enrollment/set-plan` (via adapter) |
| **Body** | `emailAddress`, `affiliateCode`, `zipCode`, `quoteDetailId`, `planId` |
| **Returns** | Adapter returns `step: "details"` and optional `redirectUrl` |

**Possible issues:**

- **400 “zipCode required”** → Session or payload missing zip; we validate zip before calling and show “Missing zip code…” if missing.
- **400/4xx/5xx** → SetPlan fails; we show `result.error` and stop.

### 5.2 Call 7: PATCH session (step + plan)

| What | Details |
|------|---------|
| **Call** | `PATCH https://api.petrxbyflex.com/enroll/session` |
| **Body** | `session_id`, `current_step: "details"`, `plan: { reimbursement, deductible }` |

**Possible issues:**

- **400/500** → Session step not updated; we still call refetch and move on; UI may be out of sync with backend.

### 5.3 Call 8: GET session (refetch)

| What | Details |
|------|---------|
| **Call** | `GET https://api.petrxbyflex.com/enroll/session?session_id=...` |
| **Who** | `refetch()` after PATCH |

Then we set `transitioning(false)` and the UI shows the **Your details** step.

---

## 6. User clicks “Continue to Payment” (details → payment)

### 6.1 Call 9: SetupPending (adapter)

| What | Details |
|------|---------|
| **Call** | Backend enrollment API (SetupPending) via adapter |
| **Input** | lead (email, zipCode, leadId, …), pets (with deductible/reimbursement), acceptElectronicConsent |

**Possible issues:**

- **Missing enrollmentState.leadId** → We show “Missing leadId. Please start from the quote step.” (shouldn’t happen if user came from quote step in same session).
- **Missing pet.date_of_birth** → Session has `birth_month`/`birth_year` but adapter may expect `date_of_birth`; could cause validation/API errors.

### 6.2 Call 10: PATCH session (step = payment)

### 6.3 Call 11: GET session (refetch)

---

## 7. User clicks “Review & Confirm” (payment → confirm)

### 7.1 Call 12: Enroll (adapter)

### 7.2 Call 13: PATCH session (step = confirm)

### 7.3 Call 14: GET session (refetch)

---

## Summary table (quote step through first transition)

| # | When | Method | URL / purpose |
|---|------|--------|----------------|
| 1 | Page load | GET | `/enroll/session?session_id=...` — load session |
| 2 | useEffect (no products) | POST | `/api/enrollment/lead` — CreateLead |
| 3 | After CreateLead | PATCH | `/enroll/session` — save products + lead_id + quote_detail_id |
| 4 | After PATCH | GET | `/enroll/session?session_id=...` — refetch |
| 5 | If zip present | GET | `https://api.zippopotam.us/us/{zip}` — city/state (optional) |
| 6 | “Continue to Details” | POST | `/api/enrollment/set-plan` — SetPlan |
| 7 | After SetPlan | PATCH | `/enroll/session` — step + plan |
| 8 | After PATCH | GET | `/enroll/session?session_id=...` — refetch |

---

## Main issues to watch

1. **lead_id / quote_detail_id not in session**  
   Run migration `2026-02-05_enrollment_sessions_lead_quote_ids.sql` so PATCH can store and GET can return them. Otherwise “Continue to Details” can show “Quote data didn’t load correctly” if React state is lost (e.g. remount).

2. **CreateLead never runs**  
   If `insurance_products` is already non-empty (e.g. from a previous run), we skip CreateLead and never set `enrollmentState`. Ids must then come from session; if migration wasn’t run, we have no ids.

3. **Session missing required fields**  
   CreateLead needs pet (zip_code, name, birth_month/birth_year), owner (email). If session is incomplete, we skip CreateLead or fail later with “missing…” errors.

4. **Duplicate-products clear**  
   If we detect all products as duplicates we PATCH session with empty products and refetch; that triggers a new CreateLead on next effect run. Extra PATCH + GET.

5. **Zip lookup (Zippopotam)**  
   External, CORS or rate limits can prevent city/state pre-fill; flow still works, details form just doesn’t get city/state from zip.

6. **SetupPending / Enroll**  
   Depend on correct lead/pet/consent data; mismatched or missing fields (e.g. date_of_birth) can cause API errors even if quote and SetPlan succeeded.
