#!/usr/bin/env node
/**
 * Retry breed reference downloads that failed with download_failed.
 * Reads data/breed-reference-missing.json, filters to download_failed entries,
 * re-attempts download using the same robust logic as fetch-breed-reference-images.mjs.
 * On success: writes ref-1.jpg + meta.json, removes from missing list.
 * On failure: keeps entry but adds/updates detail field.
 * CLI: --species dogs|cats|all --limit N --concurrency K (default 1) --force
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, unlinkSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const MISSING_PATH = join(root, "data", "breed-reference-missing.json")
const REPORT_PATH = join(root, "data", "breed-reference-report.json")
const REFS_BASE = join(root, "data", "breed-references")
const DOGS_REF = join(REFS_BASE, "dogs")
const CATS_REF = join(REFS_BASE, "cats")

const WIKI_API = "https://en.wikipedia.org/w/api.php"
const WIKIDATA_API = "https://www.wikidata.org/w/api.php"
const COMMONS_API = "https://commons.wikimedia.org/w/api.php"

const CONCURRENCY_DEFAULT = 1
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
  DOWNLOAD_FAILED: "download_failed",
}

function parseArgs() {
  const args = process.argv.slice(2)
  let species = "all"
  let limit = Infinity
  let force = false
  let concurrency = CONCURRENCY_DEFAULT
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--species" && args[i + 1]) {
      species = args[++i]
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--force") {
      force = true
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[++i], 10) || CONCURRENCY_DEFAULT)
    }
  }
  return { species, limit, force, concurrency }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function randomDelay() {
  return Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)) + MIN_DELAY_MS
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

async function downloadImage(url, outPath, maxRedirects = MAX_REDIRECTS) {
  let currentUrl = url
  let finalUrl = url
  let contentType = null

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
    const contentLength = res.headers.get("content-length")
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

function normalizeLabelToSearchNames(label) {
  let s = (label || "").trim()
  if (!s) return []
  s = s.replace(/\s*\([^)]*\)/g, "").trim()
  s = s.replace(/\s+Mix\s*$/i, "")
  s = s.replace(/\s*:\s*\d+\s*-\s*\d+\s*lbs\s*$/i, "")
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

async function retryOne(entry, force) {
  const { species, value, label, url: existingUrl } = entry
  const outDir = join(species === "dogs" ? DOGS_REF : CATS_REF, String(value))
  const outPath = join(outDir, "ref-1.jpg")

  if (!force && existsSync(outPath)) {
    return { ok: true, skipped: true }
  }

  let img = null
  let metaExtra = { source: "wikipedia" }

  const searchNames = normalizeLabelToSearchNames(label)
  const searchTerms = buildSearchTerms(searchNames, species)

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
    return { ok: false, error: "No image found" }
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
    return { ok: true, contentType: downloadResult.contentType, finalUrl: downloadResult.finalUrl }
  } catch (e) {
    const errorDetail = e?.message || String(e)
    const statusMatch = errorDetail.match(/HTTP (\d+)/)
    const status = statusMatch ? statusMatch[1] : null
    return {
      ok: false,
      error: errorDetail,
      status,
      url: img.url,
      contentType: null,
    }
  }
}

async function main() {
  const { species, limit, force, concurrency } = parseArgs()

  if (!existsSync(MISSING_PATH)) {
    console.error(`Missing file not found: ${MISSING_PATH}`)
    process.exit(1)
  }

  const missing = JSON.parse(readFileSync(MISSING_PATH, "utf8"))
  const downloadFailed = missing.filter(
    (e) =>
      e.reason === REASON.DOWNLOAD_FAILED &&
      (species === "all" || e.species === species)
  )

  if (downloadFailed.length === 0) {
    console.log(`No download_failed entries found for species=${species}`)
    return
  }

  const queue = downloadFailed.slice(0, limit)
  console.log(`Retrying ${queue.length} download_failed entries...`)

  let fixed = 0
  let stillFailed = []
  const fixedIds = new Set()
  let nextStart = Date.now()

  async function runOne(entry) {
    const delay = Math.max(0, nextStart - Date.now())
    await sleep(delay)
    nextStart = Date.now() + randomDelay()
    return retryOne(entry, force)
  }

  const pending = new Set()
  for (const entry of queue) {
    while (pending.size >= concurrency) {
      await Promise.race(pending)
    }
    const p = runOne(entry).then((r) => {
      pending.delete(p)
      const { species, value, label } = entry
      process.stdout.write(`${species} ${value} ${label}... `)
      if (r.ok) {
        if (r.skipped) {
          console.log("skip")
        } else {
          console.log("ok")
          fixed++
          fixedIds.add(`${species}:${value}`)
        }
      } else {
        console.log(`fail (${r.error})`)
        stillFailed.push({
          ...entry,
          detail: r.error,
          status: r.status,
          url: r.url,
          contentType: r.contentType,
        })
      }
      return r
    })
    pending.add(p)
  }
  await Promise.all(pending)

  const otherMissing = missing.filter((e) => {
    if (e.reason !== REASON.DOWNLOAD_FAILED) return true
    const key = `${e.species}:${e.value}`
    return !fixedIds.has(key)
  })
  const updatedMissing = [...otherMissing, ...stillFailed]

  writeFileSync(MISSING_PATH, JSON.stringify(updatedMissing, null, 2), "utf8")

  let report = { fetched: 0, skipped: 0, failed: 0, startedAt: null, finishedAt: null }
  if (existsSync(REPORT_PATH)) {
    try {
      report = JSON.parse(readFileSync(REPORT_PATH, "utf8"))
    } catch {}
  }
  report.fetched = (report.fetched || 0) + fixed
  report.finishedAt = new Date().toISOString()
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")

  console.log(`Done. Fixed: ${fixed}, still failed: ${stillFailed.length}. Updated: ${MISSING_PATH}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
