#!/usr/bin/env node
/**
 * Apply manual refs from data/breeds-manual-refs-to-fill.json to public/hidden/breedMeta.json.
 * Only updates dogs[id] when thumbnailUrl and pageUrl are both non-empty.
 *
 * Usage: node scripts/apply-manual-breed-refs.mjs
 */

import { readFileSync, writeFileSync } from "fs"
import { dirname, join } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const MANUAL_REFS_PATH = join(root, "data", "breeds-manual-refs-to-fill.json")
const BREED_META_PATH = join(root, "public", "hidden", "breedMeta.json")

const manual = JSON.parse(readFileSync(MANUAL_REFS_PATH, "utf8"))
const meta = JSON.parse(readFileSync(BREED_META_PATH, "utf8"))

if (!meta.dogs) meta.dogs = {}

let applied = 0
for (const entry of manual) {
  const thumb = (entry.thumbnailUrl || "").trim()
  const page = (entry.pageUrl || "").trim()
  if (!thumb || !page) continue
  const key = String(entry.id)
  if (!meta.dogs[key]) meta.dogs[key] = {}
  meta.dogs[key].thumbnailUrl = thumb
  meta.dogs[key].pageUrl = page
  meta.dogs[key].label = entry.label || meta.dogs[key].label
  meta.dogs[key].source = "manual"
  applied++
}

writeFileSync(BREED_META_PATH, JSON.stringify(meta, null, 2) + "\n")
console.log(`Applied ${applied} manual ref(s) to breedMeta.json`)
