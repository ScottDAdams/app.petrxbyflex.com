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

## Breed icons

Breed SVGs are ID-based: one file per breed value in `public/assets/breeds/dogs/{value}.svg` and `public/assets/breeds/cats/{value}.svg`. The UI uses `getBreedIconPath(species, breedValue)` and falls back to `default.svg` on error.

**Folder contract**

- **Read-only:** `public/assets/breeds/_base/` (dog-default.svg, cat-default.svg). No script writes into `_base/`.
- **Generated output:** `public/assets/breeds/dogs/{id}.svg`, `public/assets/breeds/cats/{id}.svg`, and `dogs/default.svg` / `cats/default.svg` (copied from `_base` when missing).
- All generated SVGs are normalized with `xmlns`, `viewBox="0 0 64 64"`, `width="64"` `height="64"`, and `data-breed-*` attributes so they render in browsers and Gapplin (not as raw XML).

**Non-AI generation (template copy)**

To regenerate all breed SVGs from the master style only (same icon per species, ID in metadata):

```bash
npm run generate:breed-svgs
```

**AI pipeline (breed-specific icons)**

1. Fetch reference images from Wikipedia (best-effort, with license metadata):
   ```bash
   npm run fetch:breed-refs
   ```
   Writes to `data/breed-references/{species}/{id}/ref-1.jpg` and `meta.json`. Reports: `data/breed-reference-report.json`, `data/breed-reference-missing.json`.
   - Uses robust HTTP downloading: headers, redirect following (up to 5), temp file + rename, validates content-type and size (>10KB), converts webp→jpg.
   - Missing reasons: `wikipedia_no_results`, `wikipedia_no_thumbnail`, `wikidata_no_match`, `wikidata_no_p18`, `download_failed`.

2. Retry download failures:
   ```bash
   npm run retry:breed-refs -- --species dogs --limit 25 --concurrency 1
   ```
   Re-attempts entries with `reason="download_failed"` from the missing list. On success, removes from missing list; on failure, updates detail field. Options: `--species dogs|cats|all`, `--limit N`, `--concurrency K` (default 1), `--force`.

3. Fix breeds that stayed missing using Wikidata (P18 image):
   ```bash
   npm run fix:breed-refs:wikidata
   ```
   Reads `data/breed-reference-missing.json`, resolves label → Q-id → P18 → Commons, saves refs and updates the missing list. Optional: `--limit N`, `--force`, `--concurrency K`, `--start-at ID`.

**Missing list meanings:**
- `skip` = already exists (not re-downloaded unless `--force`)
- `wikipedia_no_results` = no Wikipedia search results found
- `wikipedia_no_thumbnail` = Wikipedia page found but no thumbnail image
- `wikidata_no_match` = Wikidata search returned no entities
- `wikidata_no_p18` = Wikidata entity found but no P18 image claim
- `download_failed` = URL found but download failed (retry script should fix many)

2. Generate breed SVGs with OpenAI (uses ref image when present; starts from master SVG, edits breed-specific features only):
   ```bash
   node scripts/generate-breed-svgs-ai.mjs --species dogs --limit 20 --concurrency 1 --force
   ```
   Progress: `data/breed-svg-progress.json`. Report: `data/breed-svg-report.json`. Mixed-breed/bucket IDs (dogs 101–104, cat 317) are skipped; UI uses `default.svg` for those.

**Quick sanity run**

```bash
npm run fetch:breed-refs
node scripts/generate-breed-svgs-ai.mjs --species dogs --limit 20 --concurrency 1 --force
```

Then open `public/assets/breeds/dogs/<id>.svg` in a browser or Gapplin to confirm it renders as an image (not raw XML).

## Breed avatars (PNG)

The UI uses **PNG avatars** (not SVGs) for breed icons. Paths: `public/assets/breed-avatars/dogs/{id}.png`, `public/assets/breed-avatars/cats/{id}.png`, and `default.png` per species. Helper: `getBreedAvatarPath(species, breedValue)` with `onError` fallback to default.

**Runbook**

1. Fetch reference images (optional but improves breed accuracy):
   ```bash
   npm run fetch:breed-refs
   ```
2. Retry download failures (optional):
   ```bash
   npm run retry:breed-refs -- --species dogs --limit 25 --concurrency 1
   ```
3. Fix missing refs via Wikidata (optional):
   ```bash
   npm run fix:breed-refs:wikidata
   ```
3. Generate breed avatars with OpenAI (style ref: `data/style-references/petrx-style.png`; optional breed ref: `data/breed-references/{species}/{id}/ref-1.jpg`):
   ```bash
   npm run generate:breed-avatars:ai -- --species dogs --limit 25 --concurrency 1
   npm run generate:breed-avatars:ai -- --species cats --missing-only
   npm run generate:breed-avatars:ai -- --species all --force --concurrency 2
   ```
   Options: `--species dogs|cats|all`, `--limit N`, `--concurrency K`, `--missing-only` (default: generate only missing), `--force` or `--all` (regenerate all). Source: `public/hidden/breedMeta.json`. Progress: `data/breed-avatar-progress.json`. Report: `data/breed-avatar-report.json`. The script writes only to `public/assets/breed-avatars/**` and these JSON files; it never overwrites existing avatars when using `--missing-only`. Requires `OPENAI_API_KEY`; optional `OPENAI_IMAGE_MODEL` (default `gpt-image-1`).

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


## Undo Mock Mode later
C. How to undo mock mode later (important)

This is clean and reversible by design.

To remove mock mode later:

Set MOCK_MODE = false

Delete:

src/mocks/mockSession.ts

MockStepper.tsx

Remove mock imports (TypeScript will guide you)

Done

No backend changes
No API changes
No DB changes
No git archaeology required

If you want to keep it around for demos:

Leave the files

Toggle the flag