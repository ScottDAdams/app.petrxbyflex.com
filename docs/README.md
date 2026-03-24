# app.petrxbyflex.com Documentation

**Last updated:** 2026-02-24

---

## What this app is

React (Vite) app for the PetRx card + insurance quote flow. Framer sends users here with a `session_id`; this app owns the product flow, API calls, and deployment to Fly.io (see root `README.md` for run/build and breed-asset notes).

---

## Documentation index

| Document | Purpose |
|----------|---------|
| [CURRENT_STATE_SNAPSHOT.md](./CURRENT_STATE_SNAPSHOT.md) | Snapshot of behavior, routes, and integration points at time of writing |
| [START_FLOW_AND_API_CALLS.md](./START_FLOW_AND_API_CALLS.md) | Start flow and which APIs are called, in order |

---

## Related

- **Root README:** `../README.md` (local dev, build, breed SVGs/avatars, Fly volume for breed PNGs)
- **Backend API:** `../../flex-pet-rx-api/docs/README.md`
- **Framer marketing site:** `../../flex-pet-rx-site/docs/README.md`

---

## Principles

- Prefer linking to code paths and existing runbooks over duplicating API shapes (those live in **flex-pet-rx-api** `API_CONTRACTS.md` where applicable).
