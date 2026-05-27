# app.petrxbyflex.com Documentation

**Last updated:** 2026-04-03

---

## What this app is

React (Vite) app for the PetRx card + insurance quote flow. Framer sends users here with a `session_id`; this app owns the product flow, API calls, and deployment to Fly.io (see root `README.md` for run/build and breed-asset notes).

**Google Analytics:** `G-J0FNGS1NH3` in `index.html` (shared with www.petrxbyflex.com). Covers all SPA routes after deploy.

**Drug pricing / search:** Implemented in **`src/features/prescriptions/`** (the “prescriptions” feature). This replaces the old standalone **drug-lookup** app, which exists only as historical backup if you still have a zip/repo.

---

## Documentation index

| Document | Purpose |
|----------|---------|
| [CURRENT_STATE_SNAPSHOT.md](./CURRENT_STATE_SNAPSHOT.md) | Snapshot of behavior, routes, and integration points at time of writing |
| [START_FLOW_AND_API_CALLS.md](./START_FLOW_AND_API_CALLS.md) | Start flow and which APIs are called, in order |

**Code map (prescriptions):** `../src/features/prescriptions/` — drug search, pricing, and related UI. Key file: `DrugPricePage.tsx`.

### DrugPricePage behavior (as of 2026-04-03)

- **Drug Name** and **Form** dropdowns auto-fetch prices immediately on change — no Update Prices button needed.
- **Strength** and **Quantity** changes require the Update Prices button.
- **Form change cascade:** On form change, the frontend first calls `GET /api/drug-form-options?name=&form=` to get correct strengths + NDC codes from `ndc_products`. The NDC for the selected strength is then passed directly to `POST /api/unarx-dash-price`, bypassing the Dash API's form-specific `relatedStrengths` limitation.
- **Strength dropdown** is populated from `ndc_products` after a form change (accurate per-form strengths), and from the Dash API `relatedStrengths` otherwise.
- API contracts: see `../../flex-pet-rx-api/docs/API_CONTRACTS.md` (Drug Pricing Endpoints section).

---

## Related

- **Root README:** `../README.md` (local dev, build, breed SVGs/avatars, Fly volume for breed PNGs)
- **Backend API:** `../../flex-pet-rx-api/docs/README.md`
- **Framer marketing site:** `../../flex-pet-rx-site/docs/README.md`
- **PetRx workspace map:** `../../docs/README.md`

---

## Principles

- Prefer linking to code paths and existing runbooks over duplicating API shapes (those live in **flex-pet-rx-api** `API_CONTRACTS.md` where applicable).
