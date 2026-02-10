#!/usr/bin/env node
/**
 * Fill missing thumbnailUrl / pageUrl / label in breedMeta.json for breeds that
 * lack reference images. Uses Wikipedia (opensearch + page summary + validation)
 * and Wikidata fallback. Rejects bad Wikipedia hits (wrong topic).
 *
 * Usage:
 *   node scripts/fill-breedmeta-from-web.mjs [--input <path>] [--species dogs|cats|all] [--limit N] [--overwrite] [--validate-existing] [--concurrency N]
 *   node scripts/fill-breedmeta-from-web.mjs --fix-non-wikimedia [--species dogs|cats|all] [--limit N] [--concurrency N]
 *   node scripts/fill-breedmeta-from-web.mjs --fill-missing-from-meta [--species dogs|cats|all] [--limit N] [--concurrency N]
 *
 * --fix-non-wikimedia: Replace thumbnailUrl/imageUrl that are NOT from Wikimedia with Wikipedia/Wikidata URLs.
 * --fill-missing-from-meta: Fill thumbnailUrl/pageUrl for breeds in breedMeta that have no image URL (e.g. the 246 missing dogs).
 * Input: --input defaults to data/breeds-missing-reference-images.md (ignored when --fix-non-wikimedia or --fill-missing-from-meta).
 * Output: updates public/hidden/breedMeta.json; writes data/breedMeta.fill-report.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

if (typeof globalThis.fetch !== "function") {
  console.error("Node 18+ is required (globalThis.fetch). Upgrade Node or install undici and use: node --experimental-require-module scripts/fill-breedmeta-from-web.mjs")
  process.exit(1)
}

const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")
const REPORT_PATH = join(root, "data", "breedMeta.fill-report.json")
const USER_AGENT = "PetRxBreedMetaFiller/1.0 (https://petrxbyflex.com; automated breed reference enrichment)"
const RATE_LIMIT_MS = 600
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

const DEFAULT_INPUT = join(root, "data", "breeds-missing-reference-images.md")

const WIKIMEDIA_IMAGE_HOSTS = ["upload.wikimedia.org", "commons.wikimedia.org"]

function parseArgs() {
  const args = process.argv.slice(2)
  let input = DEFAULT_INPUT
  let species = "all"
  let limit = Infinity
  let overwrite = false
  let validateExisting = false
  let fixNonWikimedia = false
  let fillMissingFromMeta = false
  let concurrency = 3
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--fix-non-wikimedia") {
      fixNonWikimedia = true
    } else if (args[i] === "--fill-missing-from-meta") {
      fillMissingFromMeta = true
    } else if (args[i] === "--input" && args[i + 1]) {
      input = args[++i]
    } else if (args[i] === "--species" && args[i + 1]) {
      species = args[++i]
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--overwrite") {
      overwrite = true
    } else if (args[i] === "--validate-existing") {
      validateExisting = true
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[++i], 10) || 3)
    }
  }
  if (fixNonWikimedia) overwrite = true
  if (fillMissingFromMeta) overwrite = true
  return { input, species, limit, overwrite, validateExisting, fixNonWikimedia, fillMissingFromMeta, concurrency }
}

/** Build queue of breeds in breedMeta that have no thumbnailUrl and no imageUrl (fill missing refs). */
function queueMissingFromMeta(meta, speciesFilter, limit) {
  const queue = []
  for (const species of ["dogs", "cats"]) {
    if (speciesFilter !== "all" && speciesFilter !== species) continue
    const o = meta[species] || {}
    for (const [id, entry] of Object.entries(o)) {
      const t = (entry.thumbnailUrl || "").trim()
      const i = (entry.imageUrl || "").trim()
      if (t || i) continue
      queue.push({ species, id: parseInt(id, 10) || id, name: entry.label || String(id) })
      if (queue.length >= limit) return queue
    }
  }
  return queue
}

/** Build queue of breeds that have non-Wikimedia thumbnailUrl/imageUrl (so we can replace with Wikipedia/Wikidata). */
function queueNonWikimediaFromMeta(meta, speciesFilter, limit) {
  const queue = []
  for (const species of ["dogs", "cats"]) {
    if (speciesFilter !== "all" && speciesFilter !== species) continue
    const o = meta[species] || {}
    for (const [id, entry] of Object.entries(o)) {
      const u = (entry.thumbnailUrl || entry.imageUrl || "").trim()
      if (!u) continue
      try {
        const host = new URL(u).hostname.toLowerCase()
        const isWiki = WIKIMEDIA_IMAGE_HOSTS.some((h) => host === h || host.endsWith(".wikimedia.org"))
        if (!isWiki) {
          queue.push({ species, id: parseInt(id, 10) || id, name: entry.label || String(id) })
          if (queue.length >= limit) return queue
        }
      } catch (_) {}
    }
  }
  return queue
}

function resolveInputPath(inputPath) {
  if (inputPath === DEFAULT_INPUT) return inputPath
  if (existsSync(inputPath)) return inputPath
  const fromData = join(root, "data", inputPath)
  if (existsSync(fromData)) return fromData
  const fromRoot = join(root, inputPath)
  if (existsSync(fromRoot)) return fromRoot
  return inputPath
}

/**
 * Parse breeds-missing-reference-images.md into { dogs: [{ id, name }], cats: [...] }
 */
function parseMissingMarkdown(filePath) {
  const text = readFileSync(filePath, "utf8")
  const result = { dogs: [], cats: [] }
  let current = null
  for (const line of text.split("\n")) {
    if (line.startsWith("## Dogs")) {
      current = "dogs"
      continue
    }
    if (line.startsWith("## Cats")) {
      current = "cats"
      continue
    }
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|$/)
    if (m && current) {
      const name = m[1].trim()
      const id = parseInt(m[2], 10)
      if (name && !Number.isNaN(id)) result[current].push({ id, name })
    }
  }
  return result
}

function loadBreedMeta() {
  if (!existsSync(BREED_META_PATH)) {
    return { dogs: {}, cats: {} }
  }
  return JSON.parse(readFileSync(BREED_META_PATH, "utf8"))
}

function saveBreedMeta(meta) {
  mkdirSync(dirname(BREED_META_PATH), { recursive: true })
  writeFileSync(BREED_META_PATH, JSON.stringify(meta, null, 2), "utf8")
}

function saveReport(report) {
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchWithRetry(url, opts = {}) {
  const headers = { "User-Agent": USER_AGENT, ...(opts.headers || {}) }
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...opts, headers })
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt)
        await sleep(delay)
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw lastErr
}

/** Normalize breed name for search */
function normalizeForSearch(label, options = {}) {
  let s = String(label)
    .replace(/\s*:\s*\d+\s*-\s*\d+\s*lbs?\.?/gi, "")
    .replace(/\s*\(\s*[\d\s\-+]+\s*lbs?\.?\s*\)/gi, "")
    .replace(/\//g, " ")
    .replace(/[\u2018\u2019\u201C\u201D]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .trim()
  if (options.stripMix) s = s.replace(/\s+Mix\s*$/i, "").trim()
  return s
}

/** Check if entry needs fill: missing thumbnailUrl or empty; if validateExisting, also re-validate existing. */
function needsFill(entry, overwrite, validateExisting) {
  if (overwrite) return true
  if (!entry) return true
  const t = entry.thumbnailUrl
  const missing = t == null || (typeof t === "string" && !t.trim())
  if (missing) return true
  if (validateExisting) return "revalidate"
  return false
}

/** Fetch Wikipedia page categories (Category:Dog breeds, etc.) */
async function fetchWikiCategories(pageTitle) {
  const title = encodeURIComponent(pageTitle.replace(/\s/g, "_"))
  const url = `https://en.wikipedia.org/w/api.php?action=query&prop=categories&titles=${title}&cllimit=50&format=json`
  const res = await fetchWithRetry(url)
  if (!res.ok) return []
  const data = await res.json()
  const pages = data.query && data.query.pages
  if (!pages) return []
  const page = Object.values(pages)[0]
  if (!page || page.categories === undefined) return []
  return (page.categories || []).map((c) => (c.title || "").toLowerCase())
}

/** Validate that a Wikipedia page is about a dog/cat breed. Reject protests, maps, places, etc. */
function validateWikiBreedPage(summary, categories, species) {
  const requiredCategory = species === "dogs" ? "dog breed" : "cat breed"
  const hasBreedCategory = categories.some((t) => t.includes(requiredCategory))
  const extract = (summary.extract || "").toLowerCase()
  const description = (summary.description || "").toLowerCase()
  const title = (summary.title || "").toLowerCase()
  const combined = [title, description, extract].join(" ")
  const breedPhrase = species === "dogs" ? /breed of dog|dog breed/ : /breed of cat|cat breed/
  const hasBreedMention = breedPhrase.test(combined)
  const hasRelevantKeyword = species === "dogs" ? /\b(dog|breed)\b/.test(combined) : /\b(cat|breed)\b/.test(combined)
  if (!hasBreedCategory && !hasBreedMention) return false
  if (!hasRelevantKeyword) return false
  return true
}

/** Mixed Breed / generic */
const GENERIC_DOG_PAGE = "https://en.wikipedia.org/wiki/Dog"
const GENERIC_DOG_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/640px-YellowLabradorLooking_new.jpg"
const GENERIC_CAT_PAGE = "https://en.wikipedia.org/wiki/Cat"
const GENERIC_CAT_IMAGE = "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0b/Cat_poster_1.jpg/640px-Cat_poster_1.jpg"

/** Alternate search terms when primary name fails. (Ashera/Beabull omitted: Wikidata returns wrong entities.) */
const SEARCH_ALIASES = {
  dogs: {},
  cats: {
    2074: ["American Keuda", "Keuda cat"],
    2082: ["Colorpoint Longhair", "Himalayan cat"],
    2083: ["Feral cat", "Domestic cat"],
    2085: ["Highland Lynx", "Highlander cat"],
  },
}

/** Try Wikipedia: search (top 5), then for each title fetch summary + categories and validate. */
async function tryWikipedia(searchTerm, species) {
  const suffix = species === "dogs" ? " dog breed" : " cat breed"
  const query = encodeURIComponent(searchTerm + suffix)
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${query}&limit=5&format=json`
  const res = await fetchWithRetry(searchUrl)
  if (!res.ok) return null
  const arr = await res.json()
  const titles = arr[1]
  const urls = arr[3]
  if (!titles || !titles.length) return null
  for (let i = 0; i < titles.length; i++) {
    const title = titles[i]
    const wikiTitle = title.replace(/\s/g, "_")
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
    const sumRes = await fetchWithRetry(summaryUrl)
    if (!sumRes.ok) continue
    const summary = await sumRes.json()
    const categories = await fetchWikiCategories(wikiTitle)
    await sleep(200)
    if (!validateWikiBreedPage(summary, categories, species)) continue
    const thumb = summary.thumbnail && summary.thumbnail.source
    const canonical = summary.content_urls && summary.content_urls.desktop && summary.content_urls.desktop.page
    const pageUrl = canonical || (urls && urls[i]) || `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiTitle)}`
    return {
      pageUrl,
      thumbnailUrl: thumb || null,
      source: "wikipedia",
    }
  }
  return null
}

/** Validate an existing pageUrl (Wikipedia) – used when --validate-existing. */
async function validateExistingPageUrl(pageUrl, species) {
  if (!pageUrl || !pageUrl.includes("wikipedia.org/wiki/")) return false
  const match = pageUrl.match(/wikipedia\.org\/wiki\/([^#?]+)/)
  const title = match ? decodeURIComponent(match[1]).replace(/_/g, " ") : ""
  if (!title) return false
  const wikiTitle = title.replace(/\s/g, "_")
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`
  const sumRes = await fetchWithRetry(summaryUrl)
  if (!sumRes.ok) return false
  const summary = await sumRes.json()
  const categories = await fetchWikiCategories(wikiTitle)
  await sleep(200)
  return validateWikiBreedPage(summary, categories, species)
}

/** Wikidata search + entity P18 image */
async function tryWikidata(searchTerm) {
  const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json`
  const res = await fetchWithRetry(searchUrl)
  if (!res.ok) return null
  const data = await res.json()
  const items = data.search
  if (!items || !items.length) return null
  const first = items[0]
  if (!first || !first.id) return null
  const id = first.id
  const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=claims&format=json`
  const eRes = await fetchWithRetry(entityUrl)
  if (!eRes.ok) return null
  const entities = await eRes.json()
  const entity = entities.entities && entities.entities[id]
  if (!entity || !entity.claims || !entity.claims.P18 || !entity.claims.P18.length) return null
  const p18 = entity.claims.P18[0]
  if (!p18) return null
  const filename = p18.mainsnak?.datavalue?.value
  if (!filename) return null
  const thumbnailUrl = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`
  const pageUrl = `https://www.wikidata.org/wiki/${id}`
  return { pageUrl, thumbnailUrl, source: "wikidata" }
}

async function lookupOne(breed, species, opts, meta) {
  const { overwrite, validateExisting } = opts
  const { id, name } = breed
  const key = String(id)
  const speciesObj = meta[species] || {}
  const entry = speciesObj[key]
  const need = needsFill(entry, overwrite, validateExisting)
  if (need === false) {
    return { skipped: true, species, id, breedName: name }
  }
  let replacedInvalid = false
  if (need === "revalidate" && entry && entry.pageUrl) {
    const valid = await validateExistingPageUrl(entry.pageUrl, species)
    if (valid) {
      return { skipped: true, species, id, breedName: name }
    }
    replacedInvalid = true
  }
  const attempts = []
  let result = null
  const isMixed = /^Mixed\s+Breed/i.test(name)
  if (isMixed) {
    if (species === "dogs") {
      result = { pageUrl: GENERIC_DOG_PAGE, thumbnailUrl: GENERIC_DOG_IMAGE, source: "wikipedia" }
    } else {
      result = { pageUrl: GENERIC_CAT_PAGE, thumbnailUrl: GENERIC_CAT_IMAGE, source: "wikipedia" }
    }
  }
  if (!result) {
    const searchNames = [normalizeForSearch(name, { stripMix: true })]
    const aliases = SEARCH_ALIASES[species] && SEARCH_ALIASES[species][id]
    if (aliases && Array.isArray(aliases)) searchNames.push(...aliases)

    for (const searchName of searchNames) {
      result = await tryWikipedia(searchName, species)
      attempts.push(`wikipedia:${searchName}`)
      if (result && !result.thumbnailUrl) {
        const wd = await tryWikidata(searchName)
        attempts.push(`wikidata:${searchName}`)
        if (wd && wd.thumbnailUrl) result = wd
      }
      if (!result || !result.thumbnailUrl) {
        const wd = await tryWikidata(searchName)
        if (!attempts.includes(`wikidata:${searchName}`)) attempts.push(`wikidata:${searchName}`)
        if (wd && wd.thumbnailUrl) result = wd
      }
      if (result && result.thumbnailUrl) break
    }
  }
  if (result && result.thumbnailUrl) {
    return {
      updated: true,
      replacedInvalid,
      species,
      id,
      key,
      breedName: name,
      entry: entry || {},
      pageUrl: result.pageUrl,
      thumbnailUrl: result.thumbnailUrl,
      source: result.source || "wikipedia",
    }
  }
  if (replacedInvalid) {
    return {
      updated: true,
      replacedInvalid: true,
      clearedInvalid: true,
      species,
      id,
      key,
      breedName: name,
      entry: entry || {},
      pageUrl: null,
      thumbnailUrl: null,
      source: null,
    }
  }
  return { unresolved: true, species, id, breedName: name, attempts }
}

async function main() {
  const { input, species, limit, overwrite, validateExisting, fixNonWikimedia, fillMissingFromMeta, concurrency } = parseArgs()
  const meta = loadBreedMeta()
  if (!meta.dogs) meta.dogs = {}
  if (!meta.cats) meta.cats = {}

  let queue = []
  if (fixNonWikimedia) {
    queue = queueNonWikimediaFromMeta(meta, species, limit)
    console.log(`Fix non-Wikimedia: ${queue.length} breeds with non-Wikimedia image URLs (species=${species}, limit=${limit})`)
  } else if (fillMissingFromMeta) {
    queue = queueMissingFromMeta(meta, species, limit)
    console.log(`Fill missing from breedMeta: ${queue.length} breeds with no image URL (species=${species}, limit=${limit})`)
  } else {
    const inputPath = resolveInputPath(input)
    if (!existsSync(inputPath)) {
      console.error("Input list not found:", inputPath)
      process.exit(1)
    }
    const missing = parseMissingMarkdown(inputPath)
    if (species === "all" || species === "dogs") {
      queue.push(...missing.dogs.map((b) => ({ ...b, species: "dogs" })))
    }
    if (species === "all" || species === "cats") {
      queue.push(...missing.cats.map((b) => ({ ...b, species: "cats" })))
    }
    queue = queue.slice(0, limit)
    console.log(`Processing ${queue.length} breeds (input=${inputPath}, species=${species}, overwrite=${overwrite}, validate-existing=${validateExisting}, concurrency=${concurrency})`)
  }

  const report = { updated: [], skipped_existing: [], replaced_invalid: [], unresolved: [] }
  const opts = { overwrite, validateExisting }
  const nextTick = { current: Date.now() }
  const run = async (item) => {
    const delay = Math.max(0, nextTick.current - Date.now())
    await sleep(delay)
    nextTick.current = Date.now() + RATE_LIMIT_MS
    try {
      return await lookupOne({ id: item.id, name: item.name }, item.species, opts, meta)
    } catch (err) {
      return { error: String(err && err.message || err), species: item.species, id: item.id, breedName: item.name }
    }
  }
  const pending = new Set()
  const outcomes = []
  for (const item of queue) {
    while (pending.size >= concurrency) {
      await Promise.race(pending)
    }
    const p = run(item).then((out) => {
      pending.delete(p)
      outcomes.push(out)
      return out
    })
    pending.add(p)
  }
  await Promise.all(pending)
  const errors = []
  for (const out of outcomes) {
    if (out.error) {
      errors.push({ species: out.species, id: out.id, breedName: out.breedName, error: out.error })
      continue
    }
    if (out.skipped) {
      report.skipped_existing.push({ species: out.species, id: out.id, breedName: out.breedName })
    } else if (out.updated) {
      if (out.replacedInvalid) {
        report.replaced_invalid.push({ species: out.species, id: out.id, breedName: out.breedName })
      }
      meta[out.species][out.key] = {
        ...out.entry,
        thumbnailUrl: out.thumbnailUrl,
        pageUrl: out.pageUrl,
        label: out.breedName,
        source: out.source,
      }
      report.updated.push({
        species: out.species,
        id: out.id,
        breedName: out.breedName,
        pageUrl: out.pageUrl,
        thumbnailUrl: out.thumbnailUrl,
        source: out.source,
      })
    } else {
      report.unresolved.push({ species: out.species, id: out.id, breedName: out.breedName, attempts: out.attempts || [] })
    }
  }
  if (errors.length) report.errors = errors
  saveBreedMeta(meta)
  saveReport(report)
  console.log(
    `Updated: ${report.updated.length}, Skipped (existing): ${report.skipped_existing.length}, Replaced (invalid): ${report.replaced_invalid.length}, Unresolved: ${report.unresolved.length}${errors.length ? `, Errors: ${errors.length}` : ""}`
  )
  if (errors.length) console.error("Errors:", errors.slice(0, 5))
  console.log(`Report: ${REPORT_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
