#!/usr/bin/env node
/**
 * AI breed SVG generator.
 * Reads data/hp_breeds.json (or breedData.json). For each breed calls OpenAI for
 * SVG only; validates; one repair if needed; writes public/assets/breeds/dogs|cats/{id}.svg.
 * Masters are READ-ONLY from public/assets/breeds/_base/ (dog-default.svg, cat-default.svg).
 * DO NOT write anything into _base/ — only dogs/ and cats/ (plus default.svg copies).
 * Progress: data/breed-svg-progress.json. Report: data/breed-svg-report.json.
 * CLI: --species dogs|cats|all --limit N --force --concurrency K
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
import { validate, getRepairPrompt } from "./svg-validate.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

// Load .env (simple parser, no dotenv dep)
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

const HP_BREEDS_PATH = join(root, "data", "hp_breeds.json")
const BREED_DATA_PATH = join(root, "data", "breedData.json")
// Masters: _base only (beagle / russian blue). Never write into _base.
const BASE_DIR = join(root, "public", "assets", "breeds", "_base")
const DOG_MASTER_PATH = join(BASE_DIR, "dog-default.svg")
const CAT_MASTER_PATH = join(BASE_DIR, "cat-default.svg")
const DOGS_OUT = join(root, "public", "assets", "breeds", "dogs")
const CATS_OUT = join(root, "public", "assets", "breeds", "cats")
const PROGRESS_PATH = join(root, "data", "breed-svg-progress.json")
const REPORT_PATH = join(root, "data", "breed-svg-report.json")
const BAD_OUTPUT_DIR = join(root, "data", "breed-svg-bad")
const REF_BASE = join(root, "data", "breed-references")

// Mixed-breed bucket IDs: skip AI generation; UI will use default.svg
const IGNORE_BREED_IDS = { dogs: new Set([101, 102, 103, 104]), cats: new Set([317]) }

const RATE_LIMIT_MS = 1200
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

const DOG_PALETTE_STR = "#2f261f #4d3d32 #6b5545 #9a6948 #af7a58 #c98d65 #db996e #f0a778 #f6fafd #ffb280 #ffc09e #ffceb3 #ffe0d1 #fff6f0"
const CAT_PALETTE_STR = "#17171b #252224 #3e3e45 #404047 #51645e #52525b #63636e #6c6c78 #737380 #81818f #8a8a99 #9696a6"

function loadBreedData() {
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
  if (!existsSync(REPORT_PATH)) return { generated: { dogs: 0, cats: 0 }, failed: [], startedAt: null, finishedAt: null }
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

/**
 * Write a bad-output debug file when validation fails or no SVG extracted.
 * @param {string} species - "dogs" | "cats"
 * @param {number} id - breed value
 * @param {{ promptSummary?: string, rawOutput?: string, validationErrors?: string[] }} info
 */
function writeBadOutput(species, id, info) {
  mkdirSync(BAD_OUTPUT_DIR, { recursive: true })
  const path = join(BAD_OUTPUT_DIR, `${species}-${id}.txt`)
  const lines = [
    "=== Prompt summary ===",
    info.promptSummary ?? "(none)",
    "",
    "=== Raw model output ===",
    info.rawOutput ?? "(none)",
    "",
    "=== Validation errors ===",
    (info.validationErrors && info.validationErrors.length) ? info.validationErrors.join("\n") : "(none)"
  ]
  writeFileSync(path, lines.join("\n"), "utf8")
}

function parseArgs() {
  const args = process.argv.slice(2)
  let species = "all"
  let limit = Infinity
  let force = false
  let concurrency = 2
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--species" && args[i + 1]) {
      species = args[++i]
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--force") {
      force = true
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[++i], 10) || 2)
    }
  }
  return { species, limit, force, concurrency }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function openaiChat(messages, model) {
  const OpenAI = (await import("openai")).default
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const resp = await client.chat.completions.create({
        model,
        messages,
        max_tokens: 4096,
        temperature: 0.3,
        stream: false
      })
      const content = resp.choices?.[0]?.message?.content
      if (content) return content.trim()
      lastErr = new Error("Empty OpenAI response")
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

/**
 * Resilient SVG extraction: strip code fences, then first <svg through last </svg> inclusive.
 * @param {string} text - Raw model response
 * @returns {string|null} - Extracted SVG or null if not found
 */
function extractSvg(text) {
  if (!text || typeof text !== "string") return null
  let out = text.trim()
  // Strip code fences if present (any ```...```)
  const fenceMatch = out.match(/```(?:svg)?\s*([\s\S]*?)```/i)
  if (fenceMatch) out = fenceMatch[1].trim()
  const open = out.indexOf("<svg")
  const close = out.lastIndexOf("</svg>")
  if (open === -1 || close === -1) return null
  if (close < open) return null
  return out.slice(open, close + 6)
}

/**
 * Normalize root <svg> so tools/browsers render: xmlns, viewBox, width, height.
 * Optionally add data-breed-* attributes. Never write into _base/.
 */
function normalizeSvgRoot(svgContent, breedAttrs = null) {
  const closeBracket = svgContent.indexOf(">", svgContent.indexOf("<svg"))
  if (closeBracket === -1) return svgContent
  const rest = svgContent.slice(closeBracket + 1)
  const attrs = [
    'xmlns="http://www.w3.org/2000/svg"',
    'viewBox="0 0 64 64"',
    'width="64"',
    'height="64"'
  ]
  if (breedAttrs) {
    const escaped = (breedAttrs.label || "").replace(/"/g, "&quot;")
    attrs.push(`data-breed-label="${escaped}"`, `data-breed-value="${breedAttrs.value}"`, `data-species="${breedAttrs.species}"`)
  }
  return `<svg ${attrs.join(" ")}>${rest}`
}

/** Count <path elements in an SVG string. */
function countPaths(svgString) {
  if (!svgString) return 0
  return (svgString.match(/<path\s/gi) || []).length
}

/**
 * Heuristic: output looks like abstract/symmetrical shapes rather than a dog/cat.
 * @param {string} svg - Candidate SVG
 * @param {number} masterPathCount - Path count from the master (dog or cat) for relative comparison
 */
function looksAbstract(svg, masterPathCount) {
  const minPaths = Math.floor((masterPathCount || 30) * 0.5)
  const pathMatch = svg.match(/<path[^>]*d\s*=\s*["'][^"']*M\s*32\s*,\s*2\s*a\s*10\s*,\s*10/i)
  if (pathMatch) return true
  const pathCount = countPaths(svg)
  if (pathCount > 0 && pathCount < minPaths) return true
  return false
}

const ABSTRACT_REPAIR_SYSTEM = "You fix SVG icons. Output only the corrected SVG, no markdown. The SVG must look like a recognizable dog (or cat), not abstract shapes. Start from the provided master SVG and only modify breed-specific features."

/**
 * Generate one breed; returns { ok, error?, svg? }.
 * Writes only to DOGS_OUT or CATS_OUT — never to _base.
 */
async function generateOneBreed(breed, species, styleMaster, paletteStr, model) {
  const { label, value } = breed
  const speciesLabel = species === "dogs" ? "dog" : "cat"
  const systemPrompt = `You are an expert SVG illustrator. Output ONLY a single SVG element. No markdown, no explanation, no code fence.

STRICT RULES:
- Root <svg> must include xmlns="http://www.w3.org/2000/svg", viewBox="0 0 64 64".
- Filled-shape icon style only. No line art. No text, <image>, <foreignObject>, <script>.
- Use ONLY these hex colors: ${paletteStr}. Total elements <= 140.

You MUST preserve the overall silhouette and proportions from the master.
Do NOT create geometric/abstract symbols.
Changes must be limited to: ear shape, muzzle length, tail shape, coat texture cues, facial markings.
Return ONLY raw SVG starting with <svg.`

  const promptSummary = `Breed: ${label} (${speciesLabel}). Master-based, palette-only, silhouette preserved.`
  const refPath = join(REF_BASE, species, String(value), "ref-1.jpg")
  const hasRef = existsSync(refPath)
  const refLine = hasRef
    ? "Use the reference image ONLY to understand breed-specific traits; match the master SVG style exactly.\n\n"
    : ""
  const userText = `Create a ${speciesLabel} icon for breed: ${label}.

Start by copying this exact master SVG, keep its overall composition and style, and only modify breed-specific features.
You MUST preserve the overall silhouette and proportions from the master.
Do NOT create geometric/abstract symbols.
Changes must be limited to: ear shape, muzzle length, tail shape, coat texture cues, facial markings.
${refLine}Master SVG (copy and adapt):

${styleMaster}

Return ONLY raw SVG starting with <svg.`

  let userContent = userText
  if (hasRef) {
    const refBuf = readFileSync(refPath)
    const b64 = refBuf.toString("base64")
    userContent = [
      { type: "text", text: userText },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }
    ]
  }

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent }
  ]

  const masterPathCount = countPaths(styleMaster)

  await sleep(RATE_LIMIT_MS)
  let rawResponse = await openaiChat(messages, model)
  let svg = extractSvg(rawResponse)

  if (!svg) {
    writeBadOutput(species, value, {
      promptSummary,
      rawOutput: rawResponse,
      validationErrors: ["No SVG in response (no <svg>...</svg> found)"]
    })
    await sleep(RATE_LIMIT_MS)
    const retryResponse = await openaiChat([
      { role: "user", content: `Your previous response was:\n\n${rawResponse}\n\nReturn ONLY the SVG. No markdown. No explanation. Just the single <svg>...</svg> element.` }
    ], model)
    svg = extractSvg(retryResponse)
    if (!svg) {
      writeBadOutput(species, value, {
        promptSummary,
        rawOutput: retryResponse,
        validationErrors: ["No SVG after single retry"]
      })
      return { ok: false, error: `No SVG in response (raw logged to data/breed-svg-bad/${species}-${value}.txt)` }
    }
    rawResponse = retryResponse
  }

  let result = validate(svg, { species })
  if (!result.ok) {
    writeBadOutput(species, value, {
      promptSummary,
      rawOutput: rawResponse,
      validationErrors: result.errors
    })
    await sleep(RATE_LIMIT_MS)
    const repairContent = getRepairPrompt(svg, result.errors, species)
    const repairedRaw = await openaiChat([
      { role: "system", content: "Fix the SVG to meet the rules. Output only the corrected SVG, no markdown." },
      { role: "user", content: repairContent }
    ], model)
    svg = extractSvg(repairedRaw)
    if (!svg) {
      writeBadOutput(species, value, {
        promptSummary,
        rawOutput: repairedRaw,
        validationErrors: [...result.errors, "No SVG in repair response"]
      })
      return { ok: false, error: `No SVG in repair response (raw logged to data/breed-svg-bad/${species}-${value}.txt)` }
    }
    result = validate(svg, { species })
    if (!result.ok) {
      writeBadOutput(species, value, {
        promptSummary,
        rawOutput: repairedRaw,
        validationErrors: result.errors
      })
      return { ok: false, error: "Still invalid after repair: " + result.errors.join("; ") }
    }
  }

  if (looksAbstract(svg, masterPathCount)) {
    writeBadOutput(species, value, {
      promptSummary,
      rawOutput: rawResponse,
      validationErrors: ["Output looked abstract (path count < 50% of master or blocklist match)"]
    })
    await sleep(RATE_LIMIT_MS)
    const abstractRepair = await openaiChat([
      { role: "system", content: ABSTRACT_REPAIR_SYSTEM },
      { role: "user", content: `This does not look like a ${speciesLabel}. It looks abstract. Re-do by modifying the provided master. Return only the corrected <svg>...</svg>.\n\nMaster:\n${styleMaster}\n\nInvalid output:\n${svg}` }
    ], model)
    svg = extractSvg(abstractRepair)
    if (svg) {
      const again = validate(svg, { species })
      if (again.ok) {
        // use repaired
      } else {
        writeBadOutput(species, value, {
          promptSummary,
          rawOutput: abstractRepair,
          validationErrors: again.errors
        })
        svg = null
      }
    }
    if (!svg) return { ok: false, error: "Output looked abstract; repair failed or invalid (see data/breed-svg-bad/)" }
  }

  const outDir = species === "dogs" ? DOGS_OUT : CATS_OUT
  const final = normalizeSvgRoot(svg, { label, value, species })
  writeFileSync(join(outDir, `${value}.svg`), final, "utf8")
  return { ok: true, svg: final }
}

/**
 * Run up to concurrency tasks; each new task starts after RATE_LIMIT_MS from the previous start.
 */
async function runWithConcurrency(items, concurrency, rateLimitMs, fn) {
  const results = []
  let nextStart = 0
  async function runOne(index, item) {
    const delay = Math.max(0, nextStart - Date.now())
    nextStart = Date.now() + delay + rateLimitMs
    await sleep(delay)
    return fn(item, index)
  }
  const pending = new Set()
  for (let i = 0; i < items.length; i++) {
    const p = runOne(i, items[i]).then((r) => {
      pending.delete(p)
      results[i] = r
      return r
    })
    pending.add(p)
    while (pending.size >= concurrency) {
      await Promise.race(pending)
    }
  }
  await Promise.all(pending)
  return results
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is required (set in .env or environment).")
    process.exit(1)
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini"

  const { species: speciesArg, limit, force, concurrency } = parseArgs()
  const breedData = loadBreedData()
  const dogMaster = readFileSync(DOG_MASTER_PATH, "utf8")
  const catMaster = readFileSync(CAT_MASTER_PATH, "utf8")

  mkdirSync(DOGS_OUT, { recursive: true })
  mkdirSync(CATS_OUT, { recursive: true })

  // Maintain default.svg
  const dogDefault = join(DOGS_OUT, "default.svg")
  const catDefault = join(CATS_OUT, "default.svg")
  if (!existsSync(dogDefault) && existsSync(join(BASE_DIR, "dog-default.svg"))) {
    copyFileSync(join(BASE_DIR, "dog-default.svg"), dogDefault)
  }
  if (!existsSync(catDefault) && existsSync(join(BASE_DIR, "cat-default.svg"))) {
    copyFileSync(join(BASE_DIR, "cat-default.svg"), catDefault)
  }

  const progress = loadProgress()
  const completedDogs = new Set(force ? [] : progress.dogs)
  const completedCats = new Set(force ? [] : progress.cats)

  let dogs = (breedData.dogs || []).filter((b) => !IGNORE_BREED_IDS.dogs.has(b.value) && !completedDogs.has(b.value))
  let cats = (breedData.cats || []).filter((b) => !IGNORE_BREED_IDS.cats.has(b.value) && !completedCats.has(b.value))
  if (speciesArg === "dogs") cats = []
  if (speciesArg === "cats") dogs = []
  if (limit !== Infinity) {
    dogs = dogs.slice(0, limit)
    cats = cats.slice(0, limit)
  }

  const report = loadReport()
  report.startedAt = report.startedAt || new Date().toISOString()
  report.generated = { dogs: completedDogs.size, cats: completedCats.size }
  report.failed = report.failed || []
  saveReport(report)
  const failed = report.failed

  console.log(`Model: ${model}. Concurrency: ${concurrency}. Resume: ${completedDogs.size} dogs, ${completedCats.size} cats. Remaining: ${dogs.length} dogs, ${cats.length} cats.`)

  const processDogs = async () => {
    if (dogs.length === 0) return
    const results = await runWithConcurrency(dogs, concurrency, RATE_LIMIT_MS, async (breed) => {
      const r = await generateOneBreed(breed, "dogs", dogMaster, DOG_PALETTE_STR, model)
      if (r.ok) {
        completedDogs.add(breed.value)
        report.generated.dogs = completedDogs.size
        saveProgress({ dogs: [...completedDogs], cats: [...completedCats] })
        saveReport(report)
        return { value: breed.value, label: breed.label, ok: true }
      }
      failed.push({ species: "dogs", value: breed.value, label: breed.label, error: r.error })
      report.failed = failed
      saveReport(report)
      return { value: breed.value, label: breed.label, ok: false, error: r.error }
    })
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.ok) console.log(`Dog ${dogs[i].value} ${dogs[i].label} OK`)
      else console.log(`Dog ${dogs[i].value} ${dogs[i].label} FAIL: ${r.error}`)
    }
  }

  const processCats = async () => {
    if (cats.length === 0) return
    const results = await runWithConcurrency(cats, concurrency, RATE_LIMIT_MS, async (breed) => {
      const r = await generateOneBreed(breed, "cats", catMaster, CAT_PALETTE_STR, model)
      if (r.ok) {
        completedCats.add(breed.value)
        report.generated.cats = completedCats.size
        saveProgress({ dogs: [...completedDogs], cats: [...completedCats] })
        saveReport(report)
        return { value: breed.value, label: breed.label, ok: true }
      }
      failed.push({ species: "cats", value: breed.value, label: breed.label, error: r.error })
      report.failed = failed
      saveReport(report)
      return { value: breed.value, label: breed.label, ok: false, error: r.error }
    })
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.ok) console.log(`Cat ${cats[i].value} ${cats[i].label} OK`)
      else console.log(`Cat ${cats[i].value} ${cats[i].label} FAIL: ${r.error}`)
    }
  }

  await processDogs()
  await processCats()

  report.finishedAt = new Date().toISOString()
  saveReport(report)

  console.log(`Done. Generated: ${report.generated.dogs} dogs, ${report.generated.cats} cats. Failed: ${failed.length}. Report: ${REPORT_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
