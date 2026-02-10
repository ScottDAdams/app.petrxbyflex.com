#!/usr/bin/env node
/**
 * Regenerate ONLY the 5 specified dog breed avatars.
 * Hardcoded IDs: 1278, 1296, 1385, 1420, 1524
 * 
 * Guardrails:
 * - Only writes to the 5 exact paths listed below
 * - Skips if file already exists (no overwrite)
 * - Uses reference images when available
 * - Transparent PNG, 512x512, PetRx style
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

// HARDCODED: Only these 5 breeds
const TARGET_BREED_IDS = [1278, 1296, 1385, 1420, 1524]

// ALLOWED OUTPUT PATHS (guardrail)
const ALLOWED_PATHS = new Set(
  TARGET_BREED_IDS.map(id => join(root, "public", "assets", "breed-avatars", "dogs", `${id}.png`))
)

const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")
const STYLE_REF_PATH = join(root, "data", "style-references", "petrx-style.png")
const REF_BASE = join(root, "data", "breed-references")
const DOGS_AVATAR = join(root, "public", "assets", "breed-avatars", "dogs")
const RATE_LIMIT_MS = 1500
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000
const TARGET_SIZE = 512

/**
 * Guardrail: Assert that only allowed paths will be written.
 */
function assertAllowedPath(filePath) {
  // Normalize separators for comparison
  const normalized = filePath.replace(/\\/g, '/')
  const allowedNormalized = Array.from(ALLOWED_PATHS).map(p => p.replace(/\\/g, '/'))
  
  if (!allowedNormalized.includes(normalized)) {
    throw new Error(
      `GUARDRAIL VIOLATION: Attempted to write to disallowed path: ${filePath}\n` +
      `Normalized: ${normalized}\n` +
      `Allowed paths:\n${allowedNormalized.map(p => `  - ${p}`).join("\n")}`
    )
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Detect image mimetype and extension from magic bytes.
 */
function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  const bytes = Array.from(buffer.slice(0, 12))
  
  // PNG
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
  
  // JPEG
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" }
  }
  
  // WEBP
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  if (riff === "RIFF" && buffer.length >= 12) {
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (webp === "WEBP") {
      return { mime: "image/webp", ext: "webp" }
    }
  }
  
  return null
}

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

function loadBreedMeta() {
  if (!existsSync(BREED_META_PATH)) {
    throw new Error(`breedMeta.json not found: ${BREED_META_PATH}`)
  }
  return JSON.parse(readFileSync(BREED_META_PATH, "utf8"))
}

function getBreedLabel(meta, breedId) {
  const entry = meta.dogs?.[String(breedId)]
  return entry?.label || `Breed ${breedId}`
}

function findReferenceImage(breedId) {
  const refDir = join(REF_BASE, "dogs", String(breedId))
  const possibleRefs = ["ref-1.jpg", "ref-1.jpeg", "ref-1.png", "ref-1.webp"]
  for (const name of possibleRefs) {
    const candidate = join(refDir, name)
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return null
}

async function generateOne(breedId, meta, model) {
  const outPath = join(DOGS_AVATAR, `${breedId}.png`)
  
  // Guardrail: Assert this path is allowed
  assertAllowedPath(outPath)
  
  // Skip if already exists
  if (existsSync(outPath)) {
    const label = getBreedLabel(meta, breedId)
    return { ok: true, skipped: true, reason: "exists", label }
  }
  
  const label = getBreedLabel(meta, breedId)
  const refPath = findReferenceImage(breedId)
  const hasRef = refPath !== null
  
  try {
    let buffer
    if (hasRef) {
      try {
        const styleFile = readImageAsFile(STYLE_REF_PATH)
        const breedFile = readImageAsFile(refPath)
        const prompt = buildBreedPrompt("dogs", label, true)
        buffer = await openaiEditImage([styleFile, breedFile], prompt, model)
      } catch (e) {
        if (e?.message?.includes("unknown_image_type")) {
          throw new Error(`Invalid reference image: ${e.message}`)
        }
        throw e
      }
    } else {
      const prompt = buildBreedPrompt("dogs", label, false)
      buffer = await openaiGenerateImage(prompt, model)
    }
    
    const resized = await resizeTo512(buffer)
    mkdirSync(DOGS_AVATAR, { recursive: true })
    
    // Guardrail: Double-check before writing
    assertAllowedPath(outPath)
    
    writeFileSync(outPath, resized)
    return { ok: true, hasRef, label }
  } catch (e) {
    const errMsg = e?.message || String(e)
    return { ok: false, error: errMsg, label }
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

  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-1"
  const meta = loadBreedMeta()
  
  console.log(`Regenerating ${TARGET_BREED_IDS.length} specific dog breed avatars...`)
  console.log(`Target IDs: ${TARGET_BREED_IDS.join(", ")}`)
  console.log("")
  
  const results = []
  for (const breedId of TARGET_BREED_IDS) {
    const result = await generateOne(breedId, meta, model)
    results.push({ breedId, ...result })
    
    const label = result.label || `Breed ${breedId}`
    if (result.skipped && result.reason === "exists") {
      console.log(`[SKIP] ${breedId} ${label} — already exists`)
    } else if (result.ok) {
      const method = result.hasRef ? "using reference ref-1.jpg" : "prompt-only"
      console.log(`[GEN ] ${breedId} ${label} — ${method}`)
    } else {
      console.log(`[FAIL] ${breedId} ${label} — ${result.error || "unknown error"}`)
    }
    
    // Rate limiting
    if (breedId !== TARGET_BREED_IDS[TARGET_BREED_IDS.length - 1]) {
      await sleep(RATE_LIMIT_MS)
    }
  }
  
  console.log("")
  const generated = results.filter(r => r.ok && !r.skipped).length
  const skipped = results.filter(r => r.skipped).length
  const failed = results.filter(r => !r.ok).length
  
  console.log(`Summary: Generated=${generated}, Skipped=${skipped}, Failed=${failed}`)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
