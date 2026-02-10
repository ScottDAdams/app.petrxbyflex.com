#!/usr/bin/env node
/**
 * Read dogs.xlsx (columns: #, ID, Breed, ImageURL, PageURL) and update public/hidden/breedMeta.json.
 * Usage: node scripts/import-dogs-refs-from-xlsx.mjs [path/to/dogs.xlsx]
 */

import { readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import XLSX from "xlsx"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const xlsxPath = process.argv[2] || "/Users/scottadams/Downloads/dogs.xlsx"
const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")

const wb = XLSX.readFile(xlsxPath)
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 })
// Row 0 = headers (#, ID, Breed, ImageURL, PageURL); data rows 1+
const meta = JSON.parse(readFileSync(BREED_META_PATH, "utf8"))
if (!meta.dogs) meta.dogs = {}

let applied = 0
for (let i = 1; i < rows.length; i++) {
  const r = rows[i]
  const id = r[1] != null ? parseInt(r[1], 10) : NaN
  if (Number.isNaN(id)) continue
  let imageUrl = (r[3] != null ? String(r[3]) : "").trim()
  let pageUrl = (r[4] != null ? String(r[4]) : "").trim()
  // If both URLs were pasted in one cell (e.g. imageUrl + pageUrl concatenated), split on second "https://"
  if (imageUrl && !pageUrl && imageUrl.indexOf("https://", 10) > 0) {
    const idx = imageUrl.indexOf("https://", 10)
    pageUrl = imageUrl.slice(idx)
    imageUrl = imageUrl.slice(0, idx)
  }
  if (!imageUrl || !pageUrl) continue
  const key = String(id)
  if (!meta.dogs[key]) meta.dogs[key] = {}
  meta.dogs[key].thumbnailUrl = imageUrl
  meta.dogs[key].pageUrl = pageUrl
  meta.dogs[key].label = r[2] != null ? String(r[2]) : meta.dogs[key].label
  meta.dogs[key].source = "manual"
  applied++
}

writeFileSync(BREED_META_PATH, JSON.stringify(meta, null, 2) + "\n")
console.log(`Updated breedMeta.json: ${applied} dog refs from ${xlsxPath}`)
