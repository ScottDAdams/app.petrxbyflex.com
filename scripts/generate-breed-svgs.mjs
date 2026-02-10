#!/usr/bin/env node
/**
 * Generate one SVG per breed from style masters.
 * Reads data/breedData.json and public/assets/breeds/_base/{dog|cat}-default.svg,
 * writes public/assets/breeds/dogs/{value}.svg and cats/{value}.svg with
 * data-breed-label, data-breed-value, data-species on the root <svg>.
 * Idempotent: overwrites existing files.
 * Run: node scripts/generate-breed-svgs.mjs
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const breedDataPath = join(root, "data", "breedData.json")
const baseDir = join(root, "public", "assets", "breeds", "_base")
const dogsOutDir = join(root, "public", "assets", "breeds", "dogs")
const catsOutDir = join(root, "public", "assets", "breeds", "cats")

const dogMaster = readFileSync(join(baseDir, "dog-default.svg"), "utf8")
const catMaster = readFileSync(join(baseDir, "cat-default.svg"), "utf8")

const breedData = JSON.parse(readFileSync(breedDataPath, "utf8"))

function injectAttributes(svgContent, { label, value, species }) {
  const escaped = (label || "").replace(/"/g, "&quot;")
  const attrs = ` data-breed-label="${escaped}" data-breed-value="${value}" data-species="${species}"`
  return svgContent.replace(/<svg(\s)/, `<svg${attrs}$1`)
}

mkdirSync(dogsOutDir, { recursive: true })
mkdirSync(catsOutDir, { recursive: true })

let dogCount = 0
for (const { label, value } of breedData.dogs) {
  const out = injectAttributes(dogMaster, { label, value, species: "dogs" })
  writeFileSync(join(dogsOutDir, `${value}.svg`), out)
  dogCount++
}

let catCount = 0
for (const { label, value } of breedData.cats) {
  const out = injectAttributes(catMaster, { label, value, species: "cats" })
  writeFileSync(join(catsOutDir, `${value}.svg`), out)
  catCount++
}

console.log(`Wrote ${dogCount} dog SVGs to public/assets/breeds/dogs/`)
console.log(`Wrote ${catCount} cat SVGs to public/assets/breeds/cats/`)
