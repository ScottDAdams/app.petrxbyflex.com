# app.petrxbyflex.com

React app for the PetRx card + insurance quote flow. Framer redirects here with a `session_id`; this app handles the product flow only.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:5173/start?session_id=<id>` (backend must implement `GET /enroll/session?session_id=...`).

## Build

```bash
npm run build
npm run preview
```

## Verification checklist

- [x] App runs locally (`npm run dev`)
- [x] `/start?session_id=...` is the only required route and renders UI when session is valid
- [x] No Framer runtime or `addPropertyControls` in codebase
- [x] No auth, JWTs, or login
- [x] No Fly deployment (no `fly.toml`, no deploy scripts)
- [x] Card + insurance quote flow (no HP card-only-only logic)

## Backend expectations

- **GET** `/enroll/session?session_id=<uuid>` — returns session payload: `card_image_url`, `wallet_url`, `insurance_products`, `current_step`, `funnel_type`, etc.
- **PATCH** `/enroll/session` — body: `{ session_id, current_step, ... }` — updates session; UI refetches after.

Set `VITE_API_URL` to your API base (default: `https://api.petrxbyflex.com`).
