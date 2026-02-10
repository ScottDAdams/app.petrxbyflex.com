#!/usr/bin/env node
/**
 * Retry missing breed references using Wikidata (P18 image) -> Commons.
 * Reads data/breed-reference-missing.json; for each entry tries to resolve
 * label -> Q-id -> P18 filename -> Commons URL -> download.
 * Writes ref-1.jpg + meta.json under data/breed-references/{species}/{id}/.
 * Updates breed-reference-report.json (fixedViaWikidata, stillMissing) and
 * rewrites breed-reference-missing.json to only still-missing.
 * Only touches data/breed-references/** and report/missing JSON.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const REFS_BASE = join(root, "data", "breed-references")
const MISSING_PATH = join(root, "data", "breed-reference-missing.json")
const REPORT_PATH = join(root, "data", "breed-reference-report.json")

const WIKIDATA_API = "https://www.wikidata.org/w/api.php"
const COMMONS_API = "https://commons.wikimedia.org/w/api.php"

const CONCURRENCY = 3
const RATE_LIMIT_MS = 400
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000

const UA = "PetRxBreedRefs/1.0 (Wikidata fix)"

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function fetchWithRetry(url) {
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } })
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt)
        console.warn(`HTTP ${res.status}, retry in ${delay}ms...`)
        await sleep(delay)
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw lastErr
}

async function fetchImageBytes(url) {
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } })
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return Buffer.from(await res.arrayBuffer())
    } catch (e) {
      lastErr = e
      if (attempt < MAX_RETRIES - 1) await sleep(RETRY_BASE_MS * Math.pow(2, attempt))
    }
  }
  throw lastErr
}

/** Build list of search terms for a breed label. */
function buildSearchTerms(label, species) {
  const terms = new Set()
  const raw = (label || "").trim()
  if (raw) terms.add(raw)
  const noMix = raw.replace(/\s+Mix\s*$/i, "").trim()
  if (noMix) terms.add(noMix)
  const noWeight = noMix.replace(/\s*:\s*\d+\s*-\s*\d+\s*lbs\s*$/i, "").replace(/\s*:\s*\d+\s*\+\s*lbs\s*$/i, "").trim()
  if (noWeight) terms.add(noWeight)
  if (raw.includes("/")) {
    raw.split("/").forEach((half) => {
      const t = half.trim()
      if (t) terms.add(t)
    })
  }
  const withKind = species === "dogs" ? `${noWeight || raw} dog` : `${noWeight || raw} cat`
  if (withKind) terms.add(withKind)
  return [...terms].filter(Boolean)
}

/** Score a search result: higher = better. */
function scoreCandidate(entity, species, searchTerm) {
  let score = 0
  const desc = (entity.description?.en?.value || "").toLowerCase()
  const wantBreed = species === "dogs" ? "dog breed" : "cat breed"
  if (desc.includes(wantBreed)) score += 10
  const label = (entity.label?.en?.value || "").toLowerCase()
  const term = (searchTerm || "").toLowerCase()
  if (label === term) score += 5
  if (label.includes(term) || term.includes(label)) score += 2
  const aliases = (entity.aliases?.en || []).map((a) => (a.value || "").toLowerCase())
  if (aliases.some((a) => a === term || a.includes(term))) score += 3
  return score
}

/**
 * Resolve label to best Wikidata Q-id.
 * @returns {{ qid: string, fileTitle: string } | { reason: string, searchTerms?: string[], topCandidates?: Array }}
 */
async function resolveToQidAndP18(label, species) {
  const searchTerms = buildSearchTerms(label, species)
  let bestQid = null
  let bestScore = 0
  const topCandidates = []

  for (const term of searchTerms) {
    const url = `${WIKIDATA_API}?origin=*&action=wbsearchentities&search=${encodeURIComponent(term)}&language=en&format=json&limit=10`
    const data = await fetchWithRetry(url)
    const list = data?.search || []
    for (const item of list) {
      const score = scoreCandidate(item, species, term)
      topCandidates.push({ id: item.id, label: item.label?.en?.value, description: item.description?.en?.value, score })
      if (score > bestScore) {
        bestScore = score
        bestQid = item.id
      }
    }
  }

  if (!bestQid) {
    return {
      reason: "wikidata_search_no_match",
      searchTerms,
      topCandidates: topCandidates.slice(0, 3)
    }
  }

  const entityUrl = `${WIKIDATA_API}?origin=*&action=wbgetentities&ids=${bestQid}&props=claims|sitelinks|labels|descriptions&languages=en&format=json`
  const entityData = await fetchWithRetry(entityUrl)
  const entity = entityData?.entities?.[bestQid]
  if (!entity) return { reason: "wikidata_entity_not_found", searchTerms }

  const p18 = entity.claims?.P18
  if (!p18 || !p18[0]?.mainsnak?.datavalue?.value) {
    return { reason: "wikidata_no_p18", searchTerms, qid: bestQid }
  }

  const fileTitle = p18[0].mainsnak.datavalue.value
  const normalized = fileTitle.startsWith("File:") ? fileTitle : `File:${fileTitle}`
  return { qid: bestQid, fileTitle: normalized }
}

/**
 * Get Commons image URL (512px) and license metadata.
 */
async function getCommonsImageInfo(fileTitle) {
  const url = `${COMMONS_API}?origin=*&action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=512&format=json`
  const data = await fetchWithRetry(url)
  const pages = data?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0]
  const info = page?.imageinfo?.[0]
  if (!info) return null
  const meta = info.extmetadata || {}
  return {
    url: info.thumburl || info.url,
    licenseShortName: meta.LicenseShortName?.value,
    licenseUrl: meta.LicenseUrl?.value,
    attributionRequired: meta.AttributionRequired?.value,
    commonsPageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle).replace(/%2F/g, "/")}`
  }
}

function parseArgs() {
  const args = process.argv.slice(2)
  let limit = Infinity
  let force = false
  let concurrency = CONCURRENCY
  let startAt = null
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--force") force = true
    else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[++i], 10) || 3)
    } else if (args[i] === "--start-at" && args[i + 1]) {
      startAt = parseInt(args[++i], 10)
    }
  }
  return { limit, force, concurrency, startAt }
}

async function processOne(entry, force, reportFixed, stillMissing) {
  const { species, value, label } = entry
  const outDir = join(REFS_BASE, species, String(value))
  const refPath = join(outDir, "ref-1.jpg")
  if (existsSync(refPath) && !force) {
    return { ok: true, skipped: true }
  }

  await sleep(RATE_LIMIT_MS)
  const resolved = await resolveToQidAndP18(label, species)

  if (resolved.reason) {
    stillMissing.push({
      species,
      value,
      label,
      reason: resolved.reason,
      ...(resolved.searchTerms && { searchTerms: resolved.searchTerms }),
      ...(resolved.topCandidates && { topCandidates: resolved.topCandidates })
    })
    return { ok: false, reason: resolved.reason, resolved }
  }

  const { qid, fileTitle } = resolved
  const commons = await getCommonsImageInfo(fileTitle)
  if (!commons || !commons.url) {
    stillMissing.push({ species, value, label, reason: "commons_no_image", qid, fileTitle })
    return { ok: false, reason: "commons_no_image" }
  }

  await sleep(RATE_LIMIT_MS)
  const bytes = await fetchImageBytes(commons.url)
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, "ref-1.jpg"), bytes)

  const meta = {
    label,
    value,
    species,
    source: "wikidata",
    qid,
    fileTitle,
    imageUrl: commons.url,
    commonsPageUrl: commons.commonsPageUrl,
    licenseShortName: commons.licenseShortName,
    licenseUrl: commons.licenseUrl,
    attributionRequired: commons.attributionRequired,
    fetchedAt: new Date().toISOString()
  }
  writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8")

  reportFixed.push({ species, value, label, qid, fileTitle })
  return { ok: true }
}

async function main() {
  const { limit, force, concurrency, startAt } = parseArgs()

  if (!existsSync(MISSING_PATH)) {
    console.log("No data/breed-reference-missing.json found. Run fetch:breed-refs first.")
    process.exit(0)
  }

  let missing = JSON.parse(readFileSync(MISSING_PATH, "utf8"))
  if (!Array.isArray(missing)) missing = []

  if (startAt != null) {
    const idx = missing.findIndex((m) => m.value === startAt)
    if (idx >= 0) missing = missing.slice(idx)
  }
  if (limit !== Infinity) missing = missing.slice(0, limit)

  const reportFixed = []
  const stillMissing = []

  let nextStart = 0
  const RATE = RATE_LIMIT_MS
  const pending = new Set()

  for (let i = 0; i < missing.length; i++) {
    while (pending.size >= concurrency) await Promise.race(pending)
    const delay = Math.max(0, nextStart - Date.now())
    nextStart = Date.now() + delay + RATE
    await sleep(delay)

    const entry = missing[i]
    const p = processOne(entry, force, reportFixed, stillMissing).then((r) => {
      pending.delete(p)
      process.stdout.write(`${entry.species} ${entry.value} ${entry.label}... `)
      if (r.ok) console.log(r.skipped ? "skip" : "ok")
      else {
        console.log(r.reason || "fail")
        if (r.reason === "wikidata_search_no_match" && r.resolved?.searchTerms) {
          console.log(`  searchTerms: ${r.resolved.searchTerms.join(", ")}`)
          if (r.resolved.topCandidates?.length) {
            console.log(`  top: ${r.resolved.topCandidates.map((c) => `${c.id} "${c.label}" (${c.score})`).join("; ")}`)
          }
        }
        if (r.reason === "wikidata_no_p18" && r.resolved?.qid) {
          console.log(`  qid: ${r.resolved.qid} (no P18 image)`)
        }
      }
      return r
    }).catch((e) => {
      pending.delete(p)
      process.stdout.write(`${entry.species} ${entry.value} ${entry.label}... `)
      const errMsg = e instanceof Error ? e.message : (e != null && typeof e.message === "string" ? e.message : String(e ?? "unknown error"))
      console.log("error:", errMsg)
      stillMissing.push({ ...entry, reason: errMsg || "error" })
    })
    pending.add(p)
  }
  await Promise.all(pending)

  const existingReport = existsSync(REPORT_PATH)
    ? JSON.parse(readFileSync(REPORT_PATH, "utf8"))
    : {}
  const report = {
    ...existingReport,
    fixedViaWikidata: [...(existingReport.fixedViaWikidata || []), ...reportFixed],
    stillMissing,
    wikidataFixRunAt: new Date().toISOString()
  }
  mkdirSync(dirname(REPORT_PATH), { recursive: true })
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")
  mkdirSync(dirname(MISSING_PATH), { recursive: true })
  writeFileSync(MISSING_PATH, JSON.stringify(stillMissing, null, 2), "utf8")

  console.log(`Done. Fixed: ${reportFixed.length}, still missing: ${stillMissing.length}.`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
