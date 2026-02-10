#!/usr/bin/env node
/**
 * Generate PetRx-style breed avatar PNGs via OpenAI (gpt-image-1).
 * Source of truth: public/hidden/breedMeta.json (fallback: hp_breeds.json, breedData.json).
 * Style ref: data/style-references/petrx-style.png (required).
 * Optional per-breed ref: data/breed-references/{species}/{id}/ref-1.jpg|jpeg|png|webp.
 * Writes ONLY to public/assets/breed-avatars/{species}/{id}.png and data/breed-avatar-*.json.
 * Never overwrites existing avatars when --missing-only (default).
 *
 * CLI: --species dogs|cats|all --limit N --concurrency K
 *      --missing-only (default) — generate only missing avatars, skip existing
 *      --force | --all — regenerate/process all (overwrites existing)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

function loadEnv() {
  const path = join(root, ".env")
  if (!existsSync(path)) return
  const raw = readFileSync(path, "utf8")
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "")
  }
}
loadEnv()

const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")
const HP_BREEDS_PATH = join(root, "data", "hp_breeds.json")
const BREED_DATA_PATH = join(root, "data", "breedData.json")
const STYLE_REF_PATH = join(root, "data", "style-references", "petrx-style.png")
const REF_BASE = join(root, "data", "breed-references")
const AVATARS_BASE = join(root, "public", "assets", "breed-avatars")
const DOGS_AVATAR = join(AVATARS_BASE, "dogs")
const CATS_AVATAR = join(AVATARS_BASE, "cats")
const PROGRESS_PATH = join(root, "data", "breed-avatar-progress.json")
const REPORT_PATH = join(root, "data", "breed-avatar-report.json")

const IGNORE_BREED_IDS = { dogs: new Set([101, 102, 103, 104]), cats: new Set([317]) }
const RATE_LIMIT_MS = 1500
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000
const TARGET_SIZE = 512

/**
 * Load canonical breed data. Prefer breedMeta.json (source of truth), fallback to hp_breeds.json / breedData.json.
 * breedMeta format: { dogs: { "1069": { label: "Dachshund" } }, cats: { ... } }
 * Returns normalized: { dogs: [{ label, value }], cats: [...] }
 */
function loadBreedData() {
  if (existsSync(BREED_META_PATH)) {
    const raw = JSON.parse(readFileSync(BREED_META_PATH, "utf8"))
    const result = { dogs: [], cats: [] }
    for (const sp of ["dogs", "cats"]) {
      const obj = raw[sp] || {}
      for (const [value, info] of Object.entries(obj)) {
        const v = parseInt(value, 10)
        if (Number.isNaN(v)) continue
        result[sp].push({ label: (info && info.label) || value, value: v })
      }
    }
    return result
  }
  const path = existsSync(HP_BREEDS_PATH) ? HP_BREEDS_PATH : BREED_DATA_PATH
  return JSON.parse(readFileSync(path, "utf8"))
}

function loadProgress() {
  if (!existsSync(PROGRESS_PATH)) return { dogs: [], cats: [] }
  try {
    const data = JSON.parse(readFileSync(PROGRESS_PATH, "utf8"))
    return { dogs: data.dogs || [], cats: data.cats || [] }
  } catch {
    return { dogs: [], cats: [] }
  }
}

function saveProgress(progress) {
  mkdirSync(dirname(PROGRESS_PATH), { recursive: true })
  writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2), "utf8")
}

function loadReport() {
  if (!existsSync(REPORT_PATH)) {
    return { generated: { dogs: 0, cats: 0 }, failed: [], startedAt: null, finishedAt: null }
  }
  try {
    return JSON.parse(readFileSync(REPORT_PATH, "utf8"))
  } catch {
    return { generated: { dogs: 0, cats: 0 }, failed: [], startedAt: null, finishedAt: null }
  }
}

function saveReport(report) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")
}

function parseArgs() {
  const args = process.argv.slice(2)
  let species = "all"
  let limit = Infinity
  let force = false
  let missingOnly = true
  let concurrency = 2
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--species" && args[i + 1]) {
      species = args[++i]
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--force") {
      force = true
      missingOnly = false
    } else if (args[i] === "--missing-only") {
      missingOnly = true
    } else if (args[i] === "--all") {
      missingOnly = false
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[++i], 10) || 2)
    }
  }
  return { species, limit, force, missingOnly, concurrency }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Detect image mimetype and extension from magic bytes.
 * @param {Buffer} buffer - Image file buffer (first 12 bytes sufficient)
 * @returns {{ mime: string, ext: string } | null}
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null

  const bytes = Array.from(buffer.slice(0, 12))

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mime: "image/png", ext: "png" }
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" }
  }

  // WEBP: "RIFF" at start, "WEBP" at bytes 8-11
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (riff === "RIFF" && buffer.length >= 12) {
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (webp === "WEBP") {
      return { mime: "image/webp", ext: "webp" }
    }
  }

  return null
}

/**
 * Read image file and create File with correct mimetype.
 * @param {string} filePath - Path to image file
 * @returns {{ file: File, mime: string, ext: string, filename: string }}
 */
function readImageAsFile(filePath) {
  const buffer = readFileSync(filePath)
  const detected = detectImageType(buffer)
  if (!detected) {
    throw new Error(`unknown_image_type: ${filePath}`)
  }
  const { mime, ext } = detected
  const filename = filePath.includes("petrx-style") ? `style-ref.${ext}` : `breed-ref.${ext}`
  const file = new File([buffer], filename, { type: mime })
  return { file, mime, ext, filename }
}

/** Resize PNG buffer to 512x512. Uses sharp if available, else returns as-is. */
async function resizeTo512(buffer) {
  try {
    const sharp = (await import("sharp")).default
    return await sharp(buffer)
      .resize(TARGET_SIZE, TARGET_SIZE)
      .png()
      .toBuffer()
  } catch {
    return buffer
  }
}

const STYLE_PROMPT = `You are generating a PetRx-style pet avatar. The style reference image is the authority: soft 3D cartoon, smooth gradients, rounded shapes, friendly and clean with minimal detail, consistent lighting. NOT photorealistic, NOT sketchy, NOT flat vector.

CRITICAL REQUIREMENTS:
- Transparent background (alpha channel) - NO background color, NO gradient, NO circle, NO border, NO frame, NO ring, NO glow, NO halo, NO vignette.
- A stylized, friendly cartoon illustration of the pet's head and upper neck only.
- Centered composition, facing forward or slight 3/4 turn.
- Clean cutout suitable for UI avatars - subject fills approximately 80-85% of the frame.
- Consistent scale across all avatars.
- No text, no logos, no watermarks, no UI chrome.

FORBIDDEN ELEMENTS:
- NO circles, NO frames, NO borders, NO badges, NO medallions, NO stickers with outlines.
- NO drop shadows, NO glows, NO halos, NO background elements of any kind.
- NO decorative elements around the subject.

Output: 512x512 pixels, PNG format, fully transparent background (alpha channel).`

function buildBreedPrompt(species, label, hasBreedRef) {
  const animal = species === "dogs" ? "dog" : "cat"
  let traitHint = ""
  if (hasBreedRef) {
    traitHint = `The first image is the PetRx style reference (match this style exactly). The second image is a breed reference: use it ONLY to infer breed traits (ears, snout, coat pattern, face shape). Do not copy the photo literally; output must be in the soft 3D cartoon PetRx style.`
  } else {
    traitHint = `Create a reasonable generic ${animal} avatar in the same PetRx style (no specific breed reference).`
  }
  
  const breedLabel = label ? ` Breed: ${label}.` : ""
  
  return `A friendly, high-quality cartoon illustration of a ${animal}'s head and upper neck${hasBreedRef ? `, based on the provided reference image` : ""}. The ${animal} is centered, facing forward or slight 3/4 turn, with a neutral, pleasant expression. ${traitHint}${breedLabel}

${STYLE_PROMPT}`
}

async function openaiGenerateImage(prompt, model) {
  const OpenAI = (await import("openai")).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await client.images.generate({
        model,
        prompt,
        size: "1024x1024",
        n: 1,
        quality: "medium",
        background: "transparent",
        output_format: "png",
      })
      const b64 = resp.data?.[0]?.b64_json
      if (!b64) throw new Error("No image in response")
      return Buffer.from(b64, "base64")
    } catch (e) {
      lastErr = e
      const status = e?.status ?? e?.response?.status
      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt)
        console.warn(`OpenAI ${status}, retry in ${delay}ms...`)
        await sleep(delay)
      } else throw e
    }
  }
  throw lastErr
}

async function openaiEditImage(imageFiles, prompt, model) {
  const OpenAI = (await import("openai")).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const image = imageFiles.length === 1 ? imageFiles[0].file : imageFiles.map((f) => f.file)
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await client.images.edit({
        model,
        image,
        prompt,
        size: "1024x1024",
        n: 1,
        quality: "medium",
        background: "transparent",
        output_format: "png",
      })
      const b64 = resp.data?.[0]?.b64_json
      if (!b64) throw new Error("No image in response")
      return Buffer.from(b64, "base64")
    } catch (e) {
      lastErr = e
      const status = e?.status ?? e?.response?.status
      if (status === 429 || (status >= 500 && status < 600)) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt)
        console.warn(`OpenAI ${status}, retry in ${delay}ms...`)
        await sleep(delay)
      } else throw e
    }
  }
  throw lastErr
}

async function ensureDefaultAvatar(species, report, progress) {
  const outDir = species === "dogs" ? DOGS_AVATAR : CATS_AVATAR
  const defaultPath = join(outDir, "default.png")
  if (existsSync(defaultPath)) return
  mkdirSync(outDir, { recursive: true })
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"
  const animal = species === "dogs" ? "dog" : "cat"
  const prompt = `A friendly, high-quality cartoon illustration of a ${animal}'s head and upper neck. The ${animal} is centered, facing forward or slight 3/4 turn, with a neutral, pleasant expression. Create a reasonable generic ${animal} avatar in PetRx style (no specific breed reference).

${STYLE_PROMPT}`
  try {
    const buffer = await openaiGenerateImage(prompt, model)
    const resized = await resizeTo512(buffer)
    writeFileSync(defaultPath, resized)
    console.log(`${species} default.png written`)
    await sleep(RATE_LIMIT_MS)
  } catch (e) {
    console.error(`Failed to generate ${species} default.png:`, e?.message)
  }
}

async function generateOne(breed, species, progress, report, model, opts) {
  const { force, missingOnly } = opts
  const { label, value } = breed
  const lab = label || String(value)
  const outDir = species === "dogs" ? DOGS_AVATAR : CATS_AVATAR
  const outPath = join(outDir, `${value}.png`)

  if (existsSync(outPath)) {
    if (missingOnly) {
      return { ok: true, skipped: true, reason: "exists" }
    }
    if (!force) {
      const completed = progress[species] || []
      if (completed.includes(value)) {
        return { ok: true, skipped: true, reason: "progress" }
      }
    }
  }
  const refDir = join(REF_BASE, species, String(value))
  const possibleRefs = ["ref-1.jpg", "ref-1.jpeg", "ref-1.png", "ref-1.webp"]
  let refPath = null
  for (const name of possibleRefs) {
    const candidate = join(refDir, name)
    if (existsSync(candidate)) {
      refPath = candidate
      break
    }
  }
  const hasRef = refPath !== null
  try {
    let buffer
    if (hasRef) {
      try {
        const styleFile = readImageAsFile(STYLE_REF_PATH)
        const breedFile = readImageAsFile(refPath)
        const prompt = buildBreedPrompt(species, label, true)
        buffer = await openaiEditImage([styleFile, breedFile], prompt, model)
      } catch (e) {
        if (e?.message?.includes("unknown_image_type")) {
          report.failed.push({ species, value, label: lab, error: e.message })
          return { ok: false, error: e.message }
        }
        throw e
      }
    } else {
      const prompt = buildBreedPrompt(species, label, false)
      buffer = await openaiGenerateImage(prompt, model)
    }
    const resized = await resizeTo512(buffer)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(outPath, resized)
    const completed = progress[species] || []
    if (!completed.includes(value)) completed.push(value)
    progress[species] = completed
    saveProgress(progress)
    report.generated[species] = (report.generated[species] || 0) + 1
    return { ok: true, hasRef }
  } catch (e) {
    const errMsg = e?.message || String(e)
    report.failed.push({ species, value, label: lab, error: errMsg })
    return { ok: false, error: errMsg }
  }
}

async function main() {
  if (!existsSync(STYLE_REF_PATH)) {
    console.error("Style reference required but missing:", STYLE_REF_PATH)
    process.exit(1)
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required (set in .env or environment).")
    process.exit(1)
  }

  const { species, limit, force, missingOnly, concurrency } = parseArgs()
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"
  const opts = { force, missingOnly }

  const data = loadBreedData()
  const breedSource = existsSync(BREED_META_PATH) ? "breedMeta.json" : existsSync(HP_BREEDS_PATH) ? "hp_breeds.json" : "breedData.json"
  console.log(`Breed source: ${breedSource}. Mode: ${missingOnly ? "missing-only" : force ? "force" : "default"}`)
  const progress = loadProgress()
  const report = loadReport()
  report.startedAt = report.startedAt || new Date().toISOString()
  if (!report.generated) report.generated = { dogs: 0, cats: 0 }
  if (!report.failed) report.failed = []

  const queue = []
  if (species === "all" || species === "dogs") {
    const dogs = (data.dogs || []).filter((b) => !IGNORE_BREED_IDS.dogs.has(b.value))
    queue.push(...dogs.map((b) => ({ breed: b, species: "dogs" })))
  }
  if (species === "all" || species === "cats") {
    const cats = (data.cats || []).filter((b) => !IGNORE_BREED_IDS.cats.has(b.value))
    queue.push(...cats.map((b) => ({ breed: b, species: "cats" })))
  }

  const limited = queue.slice(0, limit)
  if (limited.length === 0) {
    console.log("No breeds to process.")
    return
  }

  await ensureDefaultAvatar("dogs", report, progress)
  await ensureDefaultAvatar("cats", report, progress)

  let nextStart = Date.now()
  const pending = new Set()
  for (const { breed, species: s } of limited) {
    while (pending.size >= concurrency) {
      await Promise.race(pending)
    }
    const delay = Math.max(0, nextStart - Date.now())
    await sleep(delay)
    nextStart = Date.now() + RATE_LIMIT_MS
    const p = generateOne(breed, s, progress, report, model, opts).then((r) => {
      pending.delete(p)
      const lab = breed.label || String(breed.value)
      const val = breed.value
      if (r.ok) {
        if (r.skipped && r.reason === "exists") {
          console.log(`[SKIP] ${lab} (${val}) — already exists`)
        } else if (r.skipped) {
          console.log(`[SKIP] ${lab} (${val}) — skipped`)
        } else {
          console.log(`[GEN ] ${lab} (${val}) — ${r.hasRef ? "with reference" : "prompt-only"}`)
        }
      } else {
        console.log(`[FAIL] ${lab} (${val}) — ${r.error || "unknown error"}`)
      }
      return r
    })
    pending.add(p)
  }
  await Promise.all(pending)

  report.finishedAt = new Date().toISOString()
  saveReport(report)
  console.log(
    `Done. Generated: dogs=${report.generated.dogs || 0}, cats=${report.generated.cats || 0}. Failed: ${report.failed.length}. Report: ${REPORT_PATH}`
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
