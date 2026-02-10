#!/usr/bin/env node
/**
 * Fetch one reference image per breed: Wikipedia first (top 3 results, first with thumbnail),
 * then Wikidata P18 + Commons as fallback.
 * Label → searchName: improved normalization (strip Mix, buckets, split on /, normalize dashes).
 * Reads data/hp_breeds.json or data/breedData.json.
 * Saves to data/breed-references/{dogs|cats}/{id}/ref-1.jpg and meta.json.
 * Writes data/breed-reference-report.json and data/breed-reference-missing.json.
 * Missing reasons: wikipedia_no_results | wikipedia_no_thumbnail | wikidata_no_match | wikidata_no_p18 | download_failed
 * Throttling: concurrency 2, random 800-1500ms delay, retry 429/5xx with backoff.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const HP_BREEDS_PATH = join(root, "data", "hp_breeds.json")
const BREED_DATA_PATH = join(root, "data", "breedData.json")
const REFS_BASE = join(root, "data", "breed-references")
const DOGS_REF = join(REFS_BASE, "dogs")
const CATS_REF = join(REFS_BASE, "cats")
const REPORT_PATH = join(root, "data", "breed-reference-report.json")
const MISSING_PATH = join(root, "data", "breed-reference-missing.json")
const IGNORE_BREED_IDS = { dogs: new Set([101, 102, 103, 104]), cats: new Set([317]) }

const WIKI_API = "https://en.wikipedia.org/w/api.php"
const WIKIDATA_API = "https://www.wikidata.org/w/api.php"
const COMMONS_API = "https://commons.wikimedia.org/w/api.php"
const CONCURRENCY = 2
const MIN_DELAY_MS = 800
const MAX_DELAY_MS = 1500
const MAX_RETRIES = 3
const RETRY_BASE_MS = 2000
const MAX_REDIRECTS = 5
const MIN_FILE_SIZE = 10 * 1024

const HEADERS = {
  "User-Agent": "PetRxBreedRefBot/1.0 (contact: support@petrxbyflex.com)",
  "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
}

const REASON = {
  WIKIPEDIA_NO_RESULTS: "wikipedia_no_results",
  WIKIPEDIA_NO_THUMBNAIL: "wikipedia_no_thumbnail",
  WIKIDATA_NO_MATCH: "wikidata_no_match",
  WIKIDATA_NO_P18: "wikidata_no_p18",
  DOWNLOAD_FAILED: "download_failed",
}

function loadBreedData() {
  const path = existsSync(HP_BREEDS_PATH) ? HP_BREEDS_PATH : BREED_DATA_PATH
  return JSON.parse(readFileSync(path, "utf8"))
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS
}

/**
 * Improved label normalization:
 * - Remove trailing " Mix"
 * - Remove weight buckets (": 1 - 10 lbs", ": 60+ lbs")
 * - Split on "/" and try each token
 * - Strip parentheses content
 * - Normalize dashes and extra spaces
 * - Handle "Bull Terrier - miniature" → "Miniature Bull Terrier"
 */
function normalizeLabelToSearchNames(label) {
  let s = (label || "").trim()
  if (!s) return []
  s = s.replace(/\s*\([^)]*\)/g, "").trim()
  s = s.replace(/\s+Mix\s*$/i, "")
  s = s.replace(/\s*:\s*\d+\s*-\s*\d+\s*lbs\s*$/i, "")
  s = s.replace(/\s*:\s*\d+\s*\+\s*lbs\s*$/i, "")
  s = s.replace(/\s*:\s*\d+\s*\+\s*lbs\s*$/i, "")
  s = s.replace(/\s+/g, " ").trim()
  if (!s) return [label.trim()]

  const results = new Set()

  const parts = s.split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean)
  for (let part of parts) {
    part = part.replace(/\s+/g, " ").trim()
    if (!part) continue

    const dashMatch = part.match(/^(.+?)\s*-\s*(miniature|toy|standard|giant|mini|small|large|medium)$/i)
    if (dashMatch) {
      const [, breed, size] = dashMatch
      const reordered = `${size.charAt(0).toUpperCase() + size.slice(1).toLowerCase()} ${breed.trim()}`
      results.add(reordered)
      results.add(breed.trim())
    } else {
      results.add(part)
    }
  }

  return [...results].filter(Boolean)
}

function buildSearchTerms(searchNames, species) {
  const suffix = species === "dogs" ? " dog" : " cat"
  return searchNames.map((name) => name + suffix)
}

async function fetchWithRetry(url) {
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS })
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

/**
 * Robust image downloader:
 * - Follows redirects (up to 5)
 * - Validates status 200, content-type image/*, size > 10KB
 * - Downloads to temp file, then renames
 * - Converts webp to jpg if needed
 */
async function downloadImage(url, outPath, maxRedirects = MAX_REDIRECTS) {
  let currentUrl = url
  let finalUrl = url
  let contentType = null
  let contentLength = null

  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    const res = await fetch(currentUrl, {
      headers: HEADERS,
      redirect: "manual",
    })

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location")
      if (!location) throw new Error(`Redirect ${res.status} but no Location header`)
      currentUrl = new URL(location, currentUrl).href
      finalUrl = currentUrl
      continue
    }

    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status} (final URL: ${finalUrl})`)
    }

    contentType = res.headers.get("content-type") || ""
    contentLength = res.headers.get("content-length")
    const size = contentLength ? parseInt(contentLength, 10) : null

    if (!contentType.startsWith("image/")) {
      throw new Error(`Invalid content-type: ${contentType} (expected image/*)`)
    }

    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const actualSize = buffer.length

    if (actualSize < MIN_FILE_SIZE) {
      throw new Error(`File too small: ${actualSize} bytes (minimum ${MIN_FILE_SIZE})`)
    }

    if (size && actualSize !== size) {
      console.warn(`Size mismatch: expected ${size}, got ${actualSize}`)
    }

    const tempPath = outPath + ".tmp"
    writeFileSync(tempPath, buffer)

    let finalBuffer = buffer
    let finalExt = ".jpg"

    if (contentType.includes("webp")) {
      try {
        const sharp = (await import("sharp")).default
        finalBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer()
        finalExt = ".jpg"
      } catch (e) {
        console.warn(`WebP conversion failed, saving as-is: ${e.message}`)
        finalExt = ".webp"
        finalBuffer = buffer
      }
    } else if (contentType.includes("png")) {
      finalExt = ".png"
    }

    const finalPath = outPath.replace(/\.(jpg|png|webp)$/, "") + finalExt
    writeFileSync(finalPath, finalBuffer)
    if (tempPath !== finalPath && existsSync(tempPath)) {
      unlinkSync(tempPath)
    }

    return { contentType, size: finalBuffer.length, finalUrl }
  }

  throw new Error(`Too many redirects (${maxRedirects})`)
}

async function searchWiki(term, limit = 3) {
  const url = `${WIKI_API}?origin=*&action=query&list=search&srsearch=${encodeURIComponent(term)}&format=json&srlimit=${limit}`
  const data = await fetchWithRetry(url)
  const list = data?.query?.search
  if (!list || list.length === 0) return []
  return list.slice(0, limit).map((p) => p.title)
}

async function getPageImage(pageTitle) {
  const url = `${WIKI_API}?origin=*&action=query&prop=pageimages&titles=${encodeURIComponent(pageTitle)}&pithumbsize=512&format=json`
  const data = await fetchWithRetry(url)
  const pages = data?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0]
  const thumb = page?.thumbnail?.source
  const imageTitle = page?.pageimage
  if (!thumb) return null
  return { url: thumb, imageTitle: imageTitle ? `File:${page.pageimage}` : null }
}

async function getImageMeta(imageTitle) {
  if (!imageTitle) return {}
  const url = `${WIKI_API}?origin=*&action=query&titles=${encodeURIComponent(imageTitle)}&prop=imageinfo&iiprop=extmetadata&format=json`
  const data = await fetchWithRetry(url)
  const pages = data?.query?.pages
  if (!pages) return {}
  const page = Object.values(pages)[0]
  const meta = page?.imageinfo?.[0]?.extmetadata || {}
  const license = {}
  if (meta.LicenseShortName?.value) license.LicenseShortName = meta.LicenseShortName.value
  if (meta.LicenseUrl?.value) license.LicenseUrl = meta.LicenseUrl.value
  if (meta.AttributionRequired?.value) license.AttributionRequired = meta.AttributionRequired.value
  if (meta.Artist?.value) license.Artist = meta.Artist.value
  return license
}

async function wikidataSearch(searchTerm, limit = 5) {
  const url = `${WIKIDATA_API}?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json&limit=${limit}`
  const data = await fetchWithRetry(url)
  const list = data?.search || []
  return list.map((e) => e.id).filter(Boolean)
}

async function wikidataGetP18(qid) {
  const url = `${WIKIDATA_API}?action=wbgetentities&ids=${encodeURIComponent(qid)}&props=claims&format=json`
  const data = await fetchWithRetry(url)
  const entity = data?.entities?.[qid]
  const p18 = entity?.claims?.P18
  if (!p18 || !p18[0]?.mainsnak?.datavalue?.value) return null
  return p18[0].mainsnak.datavalue.value
}

async function commonsImageInfo(filename) {
  const title = filename.startsWith("File:") ? filename : `File:${filename}`
  const url = `${COMMONS_API}?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=512&format=json`
  const data = await fetchWithRetry(url)
  const pages = data?.query?.pages
  if (!pages) return null
  const page = Object.values(pages)[0]
  const info = page?.imageinfo?.[0]
  if (!info?.url) return null
  const meta = info.extmetadata || {}
  const license = {}
  if (meta.LicenseShortName?.value) license.LicenseShortName = meta.LicenseShortName.value
  if (meta.LicenseUrl?.value) license.LicenseUrl = meta.LicenseUrl.value
  if (meta.AttributionRequired?.value) license.AttributionRequired = meta.AttributionRequired.value
  if (meta.Artist?.value) license.Artist = meta.Artist.value
  return { url: info.url, license, fileTitle: title }
}

async function processOne(breed, species, report, missing) {
  const { label, value } = breed
  const searchNames = normalizeLabelToSearchNames(label)
  const searchTerms = buildSearchTerms(searchNames, species)
  const outDir = join(species === "dogs" ? DOGS_REF : CATS_REF, String(value))
  const outPath = join(outDir, "ref-1.jpg")

  if (existsSync(outPath)) {
    report.fetched++
    report.skipped++
    return { ok: true, skipped: true }
  }

  let img = null
  let metaExtra = { source: "wikipedia" }
  let downloadError = null

  let anyResults = false
  for (const term of searchTerms) {
    const titles = await searchWiki(term, 3)
    if (titles.length === 0) continue
    anyResults = true
    for (const pageTitle of titles) {
      const pageImg = await getPageImage(pageTitle)
      if (pageImg) {
        img = pageImg
        metaExtra = {
          source: "wikipedia",
          searchTerm: term,
          pageTitle,
          pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle).replace(/%2F/g, "/")}`,
          thumbnailUrl: pageImg.url,
        }
        break
      }
      await sleep(randomDelay())
    }
    if (img) break
    await sleep(randomDelay())
  }

  if (!anyResults || !img) {
    const firstTerm = searchTerms[0] || searchNames[0] || label
    const qids = await wikidataSearch(firstTerm, 5)
    await sleep(randomDelay())
    let p18Filename = null
    let usedQid = null
    for (const qid of qids) {
      p18Filename = await wikidataGetP18(qid)
      await sleep(randomDelay())
      if (p18Filename) {
        usedQid = qid
        break
      }
    }
    if (qids.length && p18Filename) {
      const commons = await commonsImageInfo(p18Filename)
      await sleep(randomDelay())
      if (commons) {
        img = { url: commons.url, imageTitle: commons.fileTitle }
        metaExtra = {
          source: "wikidata",
          qid: usedQid,
          fileTitle: commons.fileTitle,
          imageUrl: commons.url,
          commonsPageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(commons.fileTitle).replace(/%2F/g, "/")}`,
          ...(commons.license || {}),
        }
      }
    }
  }

  if (!img) {
    const reason = !anyResults ? REASON.WIKIPEDIA_NO_RESULTS : REASON.WIKIPEDIA_NO_THUMBNAIL
    missing.push({ species, value, label, reason })
    return { ok: false }
  }

  try {
    mkdirSync(outDir, { recursive: true })
    const downloadResult = await downloadImage(img.url, outPath)
    const license =
      img.imageTitle && metaExtra.source === "wikipedia"
        ? await getImageMeta(img.imageTitle)
        : metaExtra.LicenseShortName
          ? {
              LicenseShortName: metaExtra.LicenseShortName,
              LicenseUrl: metaExtra.LicenseUrl,
              AttributionRequired: metaExtra.AttributionRequired,
              Artist: metaExtra.Artist,
            }
          : {}
    const meta = {
      label,
      value,
      species,
      ...metaExtra,
      ...license,
      fetchedAt: new Date().toISOString(),
    }
    writeFileSync(join(outDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8")
    report.fetched++
    return { ok: true }
  } catch (e) {
    const errorDetail = e?.message || String(e)
    const statusMatch = errorDetail.match(/HTTP (\d+)/)
    const status = statusMatch ? statusMatch[1] : null
    missing.push({
      species,
      value,
      label,
      reason: REASON.DOWNLOAD_FAILED,
      detail: errorDetail,
      status,
      url: img.url,
      contentType: null,
    })
    return { ok: false }
  }
}

async function main() {
  mkdirSync(DOGS_REF, { recursive: true })
  mkdirSync(CATS_REF, { recursive: true })

  const data = loadBreedData()
  const report = { fetched: 0, skipped: 0, failed: 0, startedAt: new Date().toISOString() }
  const missing = []

  const queue = [
    ...(data.dogs || [])
      .filter((b) => !IGNORE_BREED_IDS.dogs.has(b.value))
      .map((b) => ({ breed: b, species: "dogs" })),
    ...(data.cats || [])
      .filter((b) => !IGNORE_BREED_IDS.cats.has(b.value))
      .map((b) => ({ breed: b, species: "cats" })),
  ]

  let nextStart = Date.now()
  async function runOne({ breed, species }) {
    const delay = Math.max(0, nextStart - Date.now())
    await sleep(delay)
    nextStart = Date.now() + randomDelay()
    return processOne(breed, species, report, missing)
  }

  const pending = new Set()
  for (const item of queue) {
    while (pending.size >= CONCURRENCY) {
      await Promise.race(pending)
    }
    const p = runOne(item).then((r) => {
      pending.delete(p)
      const { breed, species } = item
      process.stdout.write(`${species === "dogs" ? "Dog" : "Cat"} ${breed.value} ${breed.label}... `)
      if (r.ok) console.log(r.skipped ? "skip" : "ok")
      else {
        report.failed++
        const entry = missing[missing.length - 1]
        const detail = entry?.detail || entry?.reason || "missing"
        console.log(`fail (${detail})`)
      }
      return r
    })
    pending.add(p)
  }
  await Promise.all(pending)

  report.finishedAt = new Date().toISOString()
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")
  writeFileSync(MISSING_PATH, JSON.stringify(missing, null, 2), "utf8")
  console.log(`Done. Fetched: ${report.fetched}, failed: ${report.failed}. Report: ${REPORT_PATH}, missing: ${MISSING_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
