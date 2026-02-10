#!/usr/bin/env node
/**
 * Fill missing thumbnailUrl in breedMeta.json by doing image searches.
 * Uses DuckDuckGo image search (free, no API key needed) to get first image result.
 * 
 * Usage:
 *   node scripts/fill-breedmeta-from-images.mjs [--input <path>] [--species dogs|cats|all] [--limit N] [--overwrite] [--concurrency N]
 */

import { readFileSync, writeFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

if (typeof globalThis.fetch !== "function") {
  console.error("Node 18+ is required (globalThis.fetch).")
  process.exit(1)
}

const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")
const REPORT_PATH = join(root, "data", "breedMeta.fill-report.json")
const DEFAULT_INPUT = join(root, "data", "breeds-missing-reference-images.md")
const RATE_LIMIT_MS = 500 // Be nice to DuckDuckGo but not too slow
const MAX_RETRIES = 3

function parseArgs() {
  const args = process.argv.slice(2)
  let input = DEFAULT_INPUT
  let species = "all"
  let limit = Infinity
  let overwrite = false
  let concurrency = 2 // Lower concurrency to be nice to DuckDuckGo
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      input = args[++i]
    } else if (args[i] === "--species" && args[i + 1]) {
      species = args[++i]
    } else if (args[i] === "--limit" && args[i + 1]) {
      const n = parseInt(args[++i], 10)
      limit = Number.isNaN(n) || n < 0 ? Infinity : n
    } else if (args[i] === "--overwrite") {
      overwrite = true
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Math.max(1, parseInt(args[i + 1], 10) || 2)
    }
  }
  return { input, species, limit, overwrite, concurrency }
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
  writeFileSync(BREED_META_PATH, JSON.stringify(meta, null, 2) + "\n")
}

function saveReport(report) {
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + "\n")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchWithRetry(url, options = {}) {
  let lastErr
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          ...options.headers,
        },
      })
      if (res.ok) return res
      if (res.status === 429) {
        await sleep(RATE_LIMIT_MS * (attempt + 1))
        continue
      }
      return res
    } catch (e) {
      lastErr = e
      await sleep(RATE_LIMIT_MS * (attempt + 1))
    }
  }
  throw lastErr
}

function normalizeForSearch(label) {
  return String(label)
    .replace(/\s*:\s*\d+\s*-\s*\d+\s*lbs?\.?/gi, "")
    .replace(/\s*\(\s*[\d\s\-+]+\s*lbs?\.?\s*\)/gi, "")
    .replace(/\//g, " ")
    .replace(/\s+Mix\s*$/i, "")
    .trim()
}

function needsFill(entry, overwrite) {
  if (overwrite) return true
  if (!entry) return true
  const t = entry.thumbnailUrl
  return t == null || (typeof t === "string" && !t.trim())
}

/**
 * Search for images using multiple sources
 * Tries Wikidata first (most reliable), then DuckDuckGo, then Bing
 */
async function searchImage(query, species) {
  // Try Wikidata first - most reliable, direct image URLs
  const wdUrl = await searchWikidata(query, species)
  if (wdUrl) return wdUrl
  
  // Try DuckDuckGo
  const ddgUrl = await searchDuckDuckGo(query, species)
  if (ddgUrl) return ddgUrl
  
  // Fallback to Bing with improved extraction
  return await searchBingImproved(query, species)
}

/**
 * Search Wikidata for breed images (P18 property)
 * Returns direct Commons image URLs
 */
async function searchWikidata(query, species) {
  // Try without species suffix first, as Wikidata search is more flexible
  let searchTerm = query
  
  try {
    // Search Wikidata
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTerm)}&language=en&format=json`
    const res = await fetchWithRetry(searchUrl)
    if (!res.ok) return null
    
    const data = await res.json()
    const items = data.search
    if (!items || !items.length) return null
    
    // Get entity details with P18 (image) claim
    const id = items[0].id
    const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${id}&props=claims&format=json`
    const eRes = await fetchWithRetry(entityUrl)
    if (!eRes.ok) return null
    
    const entities = await eRes.json()
    const entity = entities.entities && entities.entities[id]
    if (!entity || !entity.claims || !entity.claims.P18) return null
    
    const p18 = entity.claims.P18[0]
    const filename = p18.mainsnak && p18.mainsnak.datavalue && p18.mainsnak.datavalue.value
    if (!filename) return null
    
    // Convert Commons filename to direct image URL using Commons API
    // First get the actual file URL from Commons API
    const cleanFilename = filename.replace(/^File:/, '')
    const commonsApiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=File:${encodeURIComponent(cleanFilename)}&prop=imageinfo&iiprop=url&iiurlwidth=640&format=json`
    const commonsRes = await fetchWithRetry(commonsApiUrl)
    if (commonsRes.ok) {
      const commonsData = await commonsRes.json()
      const pages = commonsData.query?.pages
      if (pages) {
        const page = Object.values(pages)[0]
        const imageUrl = page.imageinfo?.[0]?.thumburl || page.imageinfo?.[0]?.url
        if (imageUrl) {
          return imageUrl
        }
      }
    }
    
    // Fallback: construct URL manually (may not always work)
    const encodedFilename = encodeURIComponent(cleanFilename.replace(/ /g, '_'))
    const firstChar = cleanFilename.charAt(0).toLowerCase()
    const secondChar = cleanFilename.length > 1 ? cleanFilename.charAt(1).toLowerCase() : firstChar
    return `https://upload.wikimedia.org/wikipedia/commons/thumb/${firstChar}/${firstChar}${secondChar}/${encodedFilename}/640px-${encodedFilename}`
  } catch (e) {
    // Silently fail
  }
  return null
}

/**
 * Search DuckDuckGo Images and return first image URL
 * Uses DuckDuckGo Image Search API (requires vqd token)
 */
async function searchDuckDuckGo(query, species) {
  const searchQuery = `${query} ${species} breed`
  
  try {
    // Step 1: Get the vqd token from DuckDuckGo search page
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(searchQuery)}&iax=images&ia=images`
    const htmlRes = await fetchWithRetry(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    })
    if (!htmlRes.ok) {
      return null
    }
    
    const html = await htmlRes.text()
    
    // Extract vqd token - try multiple patterns
    let vqd = null
    const vqdPatterns = [
      /vqd="([^"]+)"/,
      /vqd=([^&\s"']+)/,
      /"vqd":"([^"]+)"/,
    ]
    
    for (const pattern of vqdPatterns) {
      const match = html.match(pattern)
      if (match && match[1]) {
        vqd = match[1]
        break
      }
    }
    
    if (!vqd) {
      // Fallback: try to extract image URLs directly from HTML
      // Look for data-src or src attributes in img tags, or JSON data
      const imgPatterns = [
        /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi,
        /<img[^>]+src=["']([^"']+)["'][^>]*>/gi,
        /"image":"([^"]+)"/gi,
        /"url":"([^"]+)"/gi,
      ]
      
      const foundUrls = []
      for (const pattern of imgPatterns) {
        const matches = html.matchAll(pattern)
        for (const match of matches) {
          const url = match[1]
          if (url && url.startsWith('http') && !url.includes('duckduckgo.com') && 
              (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.webp') ||
               url.includes('i.imgur.com') || url.includes('upload.wikimedia.org') || url.includes('cdn') ||
               url.includes('static') || url.includes('images'))) {
            const lower = url.toLowerCase()
            if (!lower.includes('logo') && !lower.includes('icon') && !lower.includes('avatar') && url.length > 30) {
              foundUrls.push(url)
            }
          }
        }
      }
      if (foundUrls.length > 0) {
        return foundUrls[0]
      }
      return null
    }
    
    // Step 2: Use the vqd token to call DuckDuckGo Images API
    await sleep(500) // Rate limiting
    const apiUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(searchQuery)}&o=json&p=1&s=0&vqd=${vqd}`
    const apiRes = await fetchWithRetry(apiUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      }
    })
    
    if (!apiRes.ok) {
      return null
    }
    
    const data = await apiRes.json()
    
    // DuckDuckGo API returns results array with image URLs
    if (data.results && Array.isArray(data.results) && data.results.length > 0) {
      for (const result of data.results) {
        // Try image field first, then thumbnail, then url
        const imageUrl = result.image || result.thumbnail || result.url
        if (imageUrl && imageUrl.startsWith('http') && 
            !imageUrl.includes('duckduckgo.com') &&
            (imageUrl.includes('.jpg') || imageUrl.includes('.jpeg') || imageUrl.includes('.png') || imageUrl.includes('.webp') ||
             imageUrl.includes('i.imgur.com') || imageUrl.includes('upload.wikimedia.org') || imageUrl.includes('cdn'))) {
          const lower = imageUrl.toLowerCase()
          if (!lower.includes('logo') && !lower.includes('icon') && imageUrl.length > 30) {
            return imageUrl
          }
        }
      }
    }
  } catch (e) {
    // Silently fail and try next breed
  }
  return null
}

/**
 * Search Bing Images with improved extraction to get direct image URLs
 */
async function searchBingImproved(query, species) {
  const searchQuery = `${query} ${species} breed`
  
  try {
    const searchUrl = `https://www.bing.com/images/search?q=${encodeURIComponent(searchQuery)}&qft=+filterui:imagesize-large`
    const htmlRes = await fetchWithRetry(searchUrl, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.bing.com/',
      }
    })
    if (!htmlRes.ok) return null
    
    const html = await htmlRes.text()
    if (html.length < 1000 || html.includes('captcha') || html.includes('blocked')) return null
    
    // Bing now uses data-src attributes with thumbnail URLs
    // Extract data-src URLs and try to get the actual image URL
    const dataSrcPattern = /<img[^>]+data-src=["']([^"']+)["'][^>]*>/gi
    const foundImages = []
    let match
    
    while ((match = dataSrcPattern.exec(html)) !== null && foundImages.length < 10) {
      let thumbnailUrl = match[1]
      // Unescape HTML entities
      thumbnailUrl = thumbnailUrl.replace(/&amp;/g, '&').replace(/&quot;/g, '"')
      
      if (thumbnailUrl && thumbnailUrl.includes('bing.net/th/id/')) {
        // Try to extract the actual image URL from the thumbnail URL
        // Bing thumbnail URLs have format: https://tse2.mm.bing.net/th/id/OIP.xxx?w=...
        // The actual image might be accessible by removing query params or following redirect
        try {
          // Try following the thumbnail URL to get the actual image
          const imgRes = await fetchWithRetry(thumbnailUrl.split('?')[0], {
            redirect: 'follow',
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            }
          })
          const finalUrl = imgRes.url || thumbnailUrl
          if (finalUrl && !finalUrl.includes('bing.net/th/id/') && 
              (finalUrl.includes('.jpg') || finalUrl.includes('.jpeg') || finalUrl.includes('.png') || finalUrl.includes('.webp'))) {
            foundImages.push(finalUrl)
            if (foundImages.length >= 1) break
          }
        } catch (e) {
          // Skip this thumbnail
        }
      }
    }
    
    // Also try to find murl in JSON (if Bing still uses it)
    const murlPattern = /"murl":"([^"]+)"/g
    while ((match = murlPattern.exec(html)) !== null && foundImages.length < 10) {
      let url = match[1]
      url = url.replace(/\\\//g, '/').replace(/\\u([0-9a-fA-F]{4})/g, (m, c) => String.fromCharCode(parseInt(c, 16)))
      
      if (url && url.startsWith('http')) {
        const lower = url.toLowerCase()
        if (!lower.includes('bing.com') && !lower.includes('bing.net') &&
            (url.includes('.jpg') || url.includes('.jpeg') || url.includes('.png') || url.includes('.webp') ||
             url.includes('i.imgur.com') || url.includes('upload.wikimedia.org') || url.includes('cdn'))) {
          foundImages.push(url)
          if (foundImages.length >= 1) break
        }
      }
    }
    
    if (foundImages.length > 0) {
      return foundImages[0]
    }
  } catch (e) {
    // Silently fail
  }
  return null
}

async function lookupOne(breed, species, opts, meta) {
  const { overwrite } = opts
  const { id, name } = breed
  const key = String(id)
  const speciesObj = meta[species] || {}
  const entry = speciesObj[key]
  
  if (!needsFill(entry, overwrite)) {
    return { skipped: true, species, id, breedName: name }
  }
  
  const searchName = normalizeForSearch(name)
  const imageUrl = await searchImage(searchName, species)
  await sleep(RATE_LIMIT_MS)
  
  if (imageUrl) {
    return {
      updated: true,
      species,
      id,
      key,
      breedName: name,
      thumbnailUrl: imageUrl,
      source: "image-search",
    }
  }
  
  return { unresolved: true, species, id, breedName: name }
}

async function processBatch(items, fn, concurrency) {
  const results = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.all(batch.map(fn))
    results.push(...batchResults)
    if (i + concurrency < items.length) {
      await sleep(RATE_LIMIT_MS)
    }
  }
  return results
}

async function main() {
  const { input, species, limit, overwrite, concurrency } = parseArgs()
  const inputPath = resolveInputPath(input)
  if (!existsSync(inputPath)) {
    console.error("Input list not found:", inputPath)
    process.exit(1)
  }
  
  const missing = parseMissingMarkdown(inputPath)
  const meta = loadBreedMeta()
  const report = { updated: [], skipped_existing: [], unresolved: [] }
  
  let breeds = []
  if (species === "all") {
    breeds = [...missing.dogs, ...missing.cats]
  } else if (species === "dogs") {
    breeds = missing.dogs
  } else if (species === "cats") {
    breeds = missing.cats
  } else {
    console.error("Invalid species. Use: dogs, cats, or all")
    process.exit(1)
  }
  
  breeds = breeds.slice(0, limit)
  console.log(`Processing ${breeds.length} breeds (input=${inputPath}, species=${species}, overwrite=${overwrite}, concurrency=${concurrency})`)
  
  const results = await processBatch(
    breeds,
    (breed) => {
      const breedSpecies = species === "all" ? (missing.dogs.some(b => b.id === breed.id) ? "dogs" : "cats") : species
      return lookupOne(breed, breedSpecies, { overwrite }, meta)
    },
    concurrency
  )
  
  for (const result of results) {
    if (result.skipped) {
      report.skipped_existing.push({ species: result.species, id: result.id, breedName: result.breedName })
      continue
    }
    if (result.updated) {
      const speciesObj = meta[result.species] || {}
      speciesObj[result.key] = {
        ...speciesObj[result.key],
        thumbnailUrl: result.thumbnailUrl,
        label: result.breedName,
        source: result.source || "duckduckgo",
      }
      meta[result.species] = speciesObj
      report.updated.push({
        species: result.species,
        id: result.id,
        breedName: result.breedName,
        thumbnailUrl: result.thumbnailUrl,
        source: result.source,
      })
    } else if (result.unresolved) {
      report.unresolved.push({ species: result.species, id: result.id, breedName: result.breedName })
    }
  }
  
  saveBreedMeta(meta)
  saveReport(report)
  
  const updated = report.updated.length
  const skipped = report.skipped_existing.length
  const unresolved = report.unresolved.length
  console.log(`Updated: ${updated}, Skipped (existing): ${skipped}, Unresolved: ${unresolved}`)
  console.log(`Report: ${REPORT_PATH}`)
}

main().catch((e) => {
  console.error("Fatal error:", e)
  process.exit(1)
})
