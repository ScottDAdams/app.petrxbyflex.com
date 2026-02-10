#!/usr/bin/env node
/**
 * List breeds from data/breedData.json that do NOT have a reference image
 * in data/breed-references/{species}/{id}/ (ref-1.jpg, ref-1.jpeg, ref-1.png, ref-1.webp).
 */
import { readFileSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { dirname, join } from "path"
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, "..")

const BREED_DATA_PATH = join(root, "data", "breedData.json")
const REF_BASE = join(root, "data", "breed-references")
const REF_NAMES = ["ref-1.jpg", "ref-1.jpeg", "ref-1.png", "ref-1.webp"]

function hasRefImage(species, value) {
  const dir = join(REF_BASE, species, String(value))
  return REF_NAMES.some((name) => existsSync(join(dir, name)))
}

const data = JSON.parse(readFileSync(BREED_DATA_PATH, "utf8"))
const missing = { dogs: [], cats: [] }

for (const b of data.dogs || []) {
  if (!hasRefImage("dogs", b.value)) missing.dogs.push({ id: b.value, name: b.label })
}
for (const b of data.cats || []) {
  if (!hasRefImage("cats", b.value)) missing.cats.push({ id: b.value, name: b.label })
}

console.log("# Breeds missing reference images (from data/breedData.json)\n")
console.log("## Dogs (missing ref)")
missing.dogs.forEach(({ id, name }) => console.log(`${name} (${id})`))
console.log(`\nTotal dogs missing: ${missing.dogs.length}\n`)
console.log("## Cats (missing ref)")
missing.cats.forEach(({ id, name }) => console.log(`${name} (${id})`))
console.log(`\nTotal cats missing: ${missing.cats.length}`)
