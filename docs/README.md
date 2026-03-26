# app.petrxbyflex.com Documentation

**Last updated:** 2026-03-26

---

## What this app is

React (Vite) app for the PetRx card + insurance quote flow. Framer sends users here with a `session_id`; this app owns the product flow, API calls, and deployment to Fly.io (see root `README.md` for run/build and breed-asset notes).

**Drug pricing / search:** Implemented in **`src/features/prescriptions/`** (the “prescriptions” feature). This replaces the old standalone **drug-lookup** app, which exists only as historical backup if you still have a zip/repo.

---

## Documentation index

| Document | Purpose |
|----------|---------|
| [CURRENT_STATE_SNAPSHOT.md](./CURRENT_STATE_SNAPSHOT.md) | Snapshot of behavior, routes, and integration points at time of writing |
| [START_FLOW_AND_API_CALLS.md](./START_FLOW_AND_API_CALLS.md) | Start flow and which APIs are called, in order |

**Code map (prescriptions):** `../src/features/prescriptions/` — drug search, pricing, and related UI (calls API proxies such as `unarx-fast-batch` per `API_CONTRACTS.md`).

---

## Related

- **Root README:** `../README.md` (local dev, build, breed SVGs/avatars, Fly volume for breed PNGs)
- **Backend API:** `../../flex-pet-rx-api/docs/README.md`
- **Framer marketing site:** `../../flex-pet-rx-site/docs/README.md`
- **PetRx workspace map:** `../../docs/README.md`

---

## Principles

- Prefer linking to code paths and existing runbooks over duplicating API shapes (those live in **flex-pet-rx-api** `API_CONTRACTS.md` where applicable).
