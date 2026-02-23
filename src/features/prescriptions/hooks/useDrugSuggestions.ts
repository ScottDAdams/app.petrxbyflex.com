import { useState, useCallback, useRef, useEffect } from "react"

export interface DrugSuggestion {
  label: string
  value: string
  display?: string
  category?: string
}

const DEBOUNCE_MS = 300
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes
const CACHE_MAX_SIZE = 200

/** Common drug names to preload on mount (optional, low risk). */
const COMMON_DRUGS_PRELOAD = ["Lisinopril", "Metformin", "Atorvastatin"]

function debounce<A extends unknown[]>(fn: (...args: A) => void, delay: number): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout>
  return (...args: A) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function toSuggestions(names: string[]): DrugSuggestion[] {
  return (names || []).map((name) => ({
    label: name,
    value: name,
    display: name,
  }))
}

/** Sort so starts-with matches come first, then contains. */
function sortByRelevance(suggestions: DrugSuggestion[], termLower: string): DrugSuggestion[] {
  if (!termLower) return suggestions
  const startsWith: DrugSuggestion[] = []
  const contains: DrugSuggestion[] = []
  for (const s of suggestions) {
    const labelLower = s.label.toLowerCase()
    if (labelLower.startsWith(termLower)) startsWith.push(s)
    else if (labelLower.includes(termLower)) contains.push(s)
  }
  return [...startsWith, ...contains]
}

interface CacheEntry {
  data: DrugSuggestion[]
  timestamp: number
}

export function useDrugSuggestions(apiBase: string) {
  const cleanApiBase = (apiBase || "").replace(/\/+$/, "")
  const [suggestions, setSuggestions] = useState<DrugSuggestion[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const abortControllerRef = useRef<AbortController | null>(null)
  const latestTermRef = useRef<string>("")

  const evictCacheIfNeeded = useCallback(() => {
    const cache = cacheRef.current
    if (cache.size < CACHE_MAX_SIZE) return
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }, [])

  const fetchSuggestions = useCallback(
    debounce(async (term: string) => {
      const trimmed = term.trim()
      if (trimmed.length < 3) {
        setSuggestions([])
        setError(null)
        return
      }
      const cacheKey = trimmed.toLowerCase()
      const now = Date.now()
      const cached = cacheRef.current.get(cacheKey)
      if (cached && now - cached.timestamp < CACHE_TTL_MS) {
        setSuggestions(cached.data)
        setError(null)
        setIsLoading(false)
        return
      }

      if (abortControllerRef.current) abortControllerRef.current.abort()
      const controller = new AbortController()
      abortControllerRef.current = controller
      latestTermRef.current = trimmed
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(
          `${cleanApiBase}/api/unarx-drug-names-search?term=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        )
        if (trimmed !== latestTermRef.current) return
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ message: "Suggestion search failed." }))
          throw new Error(errData.message || `Network error: ${res.statusText}`)
        }
        const data: string[] = await res.json()
        const raw = toSuggestions(Array.isArray(data) ? data : [])
        if (trimmed !== latestTermRef.current) return
        const sorted = sortByRelevance(raw, cacheKey)
        evictCacheIfNeeded()
        cacheRef.current.set(cacheKey, { data: sorted, timestamp: Date.now() })
        setSuggestions(sorted)
      } catch (e: unknown) {
        if (e instanceof Error && e.name === "AbortError") return
        if (trimmed !== latestTermRef.current) return
        console.error("API error fetching suggestions:", e)
        setError("Failed to fetch drug suggestions.")
        setSuggestions([])
      } finally {
        if (trimmed === latestTermRef.current) setIsLoading(false)
      }
    }, DEBOUNCE_MS),
    [cleanApiBase, evictCacheIfNeeded]
  )

  const clearSuggestions = useCallback(() => {
    setSuggestions([])
    setError(null)
  }, [])

  // Optional preload: cache a few common terms so first keystrokes feel instant
  useEffect(() => {
    for (const drug of COMMON_DRUGS_PRELOAD) {
      const key = drug.toLowerCase()
      if (cacheRef.current.has(key)) continue
      fetch(`${cleanApiBase}/api/unarx-drug-names-search?term=${encodeURIComponent(drug)}`)
        .then((res) => {
          if (!res.ok) return
          return res.json()
        })
        .then((data: string[] | undefined) => {
          if (!Array.isArray(data)) return
          const suggestions = toSuggestions(data)
          const sorted = sortByRelevance(suggestions, key)
          if (cacheRef.current.size < CACHE_MAX_SIZE) {
            cacheRef.current.set(key, { data: sorted, timestamp: Date.now() })
          }
        })
        .catch(() => {})
    }
  }, [cleanApiBase])

  return {
    suggestions,
    isLoading,
    error,
    fetchSuggestions,
    clearSuggestions,
  }
}
