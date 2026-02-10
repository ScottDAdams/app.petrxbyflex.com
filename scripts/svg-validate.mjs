#!/usr/bin/env node
/**
 * Validates generated breed SVGs.
 * - SVG-only output, xmlns required, viewBox "0 0 64 64"
 * - No script, foreignObject, image, text
 * - Colors must be from the allowed palette for the species
 * - Total SVG elements <= 140
 * Export: validate(svgContent, { species }) => { ok, errors }
 */

const DOG_PALETTE = new Set([
  "#2f261f", "#4d3d32", "#6b5545", "#9a6948", "#af7a58", "#c98d65",
  "#db996e", "#f0a778", "#f6fafd", "#ffb280", "#ffc09e", "#ffceb3",
  "#ffe0d1", "#fff6f0"
].map((c) => c.toLowerCase()))

const CAT_PALETTE = new Set([
  "#17171b", "#252224", "#3e3e45", "#404047", "#51645e", "#52525b",
  "#63636e", "#6c6c78", "#737380", "#81818f", "#8a8a99", "#9696a6"
].map((c) => c.toLowerCase()))

const FORBIDDEN_TAGS = ["script", "foreignobject", "image", "text", "textpath", "tspan"]
const MAX_ELEMENTS = 140

/**
 * Extract viewBox from root <svg>.
 * @param {string} svg
 * @returns {string|null}
 */
function getViewBox(svg) {
  const m = svg.match(/<svg[^>]*\sviewBox\s*=\s*["']([^"']+)["']/i)
  return m ? m[1].trim() : null
}

/**
 * Check that root <svg> has xmlns (so tools/browsers render as SVG).
 * @param {string} svg
 * @returns {boolean}
 */
function hasXmlns(svg) {
  const m = svg.match(/<svg[^>]*>/i)
  if (!m) return false
  return /xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2000\/svg["']/i.test(m[0])
}

/**
 * Collect all fill/stroke color values from style="" and fill="" stroke="" attributes.
 * @param {string} svg
 * @returns {Set<string>}
 */
function normalizeHex(hex) {
  hex = hex.toLowerCase().replace(/^#/, "")
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  return hex.length === 6 ? `#${hex}` : null
}

function extractColors(svg) {
  const colors = new Set()
  const add = (v) => {
    if (v === "none" || v === "currentcolor") return
    const n = normalizeHex(v.startsWith("#") ? v : `#${v}`)
    if (n) colors.add(n)
  }
  const styleRe = /(?:fill|stroke)\s*:\s*([#a-fA-F0-9]+|currentColor|none)\s*/g
  let match
  while ((match = styleRe.exec(svg)) !== null) add(match[1])
  const attrRe = /(?:fill|stroke)\s*=\s*["']([^"']+)["']/gi
  while ((match = attrRe.exec(svg)) !== null) add(match[1].trim())
  return colors
}

/**
 * Count SVG elements (path, circle, ellipse, rect, g, etc.).
 * @param {string} svg
 * @returns {number}
 */
function countElements(svg) {
  const tagRe = /<(\w+)(?:\s|>|\/)/g
  const count = {}
  let m
  while ((m = tagRe.exec(svg)) !== null) {
    const tag = m[1].toLowerCase()
    if (tag !== "svg" && tag !== "xmlns" && tag !== "title") {
      count[tag] = (count[tag] || 0) + 1
    }
  }
  return Object.values(count).reduce((a, b) => a + b, 0)
}

/**
 * Check for forbidden tags.
 * @param {string} svg
 * @returns {string[]}
 */
function findForbiddenTags(svg) {
  const found = []
  for (const tag of FORBIDDEN_TAGS) {
    if (new RegExp(`<${tag}[\\s>]`, "i").test(svg)) found.push(tag)
  }
  return found
}

/**
 * @param {string} svgContent
 * @param {{ species: 'dogs' | 'cats' }} options
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validate(svgContent, { species }) {
  const errors = []
  const svg = (svgContent || "").trim()

  if (!svg.startsWith("<svg")) {
    errors.push("Output must be SVG-only (root element must be <svg>)")
    return { ok: false, errors }
  }

  if (!hasXmlns(svg)) {
    errors.push("Root <svg> must include xmlns=\"http://www.w3.org/2000/svg\" so tools and browsers render as SVG")
  }

  const viewBox = getViewBox(svg)
  if (!viewBox || viewBox !== "0 0 64 64") {
    errors.push(`viewBox must be exactly "0 0 64 64", got: ${viewBox || "missing"}`)
  }

  const forbidden = findForbiddenTags(svg)
  if (forbidden.length) {
    errors.push(`Forbidden elements: ${forbidden.join(", ")}`)
  }

  const palette = species === "cats" ? CAT_PALETTE : DOG_PALETTE
  const colors = extractColors(svg)
  for (const c of colors) {
    if (!palette.has(c)) {
      errors.push(`Palette violation: ${c} is not in the allowed ${species} palette`)
    }
  }

  const total = countElements(svg)
  if (total > MAX_ELEMENTS) {
    errors.push(`Too many elements: ${total} (max ${MAX_ELEMENTS})`)
  }

  return {
    ok: errors.length === 0,
    errors
  }
}

/**
 * If validation fails, build a repair prompt for one OpenAI call.
 * @param {string} invalidSvg
 * @param {string[]} errors
 * @param {'dogs'|'cats'} species
 * @returns {string}
 */
export function getRepairPrompt(invalidSvg, errors, species) {
  const palette = species === "cats"
    ? [...CAT_PALETTE].join(" ")
    : [...DOG_PALETTE].join(" ")
  return `The following SVG failed validation. Fix it so that it passes. Return only the corrected SVG, no markdown or explanation.

Errors:
${errors.join("\n")}

Rules: Root <svg> must include xmlns="http://www.w3.org/2000/svg". viewBox must be "0 0 64 64". Use only these colors: ${palette}. No script, foreignObject, image, or text. Maximum 140 elements. Filled shapes only.

Invalid SVG:
${invalidSvg}`
}

// CLI: node svg-validate.mjs <species> < path/to/file.svg
if (import.meta.url === `file://${process.argv[1]}`) {
  const species = process.argv[2] === "cats" ? "cats" : "dogs"
  const chunks = []
  process.stdin.on("data", (c) => chunks.push(c))
  process.stdin.on("end", () => {
    const svg = Buffer.concat(chunks).toString("utf8")
    const { ok, errors } = validate(svg, { species })
    if (ok) {
      console.log("OK")
      process.exit(0)
    }
    console.error(errors.join("\n"))
    process.exit(1)
  })
}
