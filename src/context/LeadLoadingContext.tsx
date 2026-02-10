/**
 * Lead loading: /api/enrollment/lead is called at most once per session when
 * session.lead_id and session.quote_detail_id are both missing. Overlay shows
 * until lead returns (success or handled failure). Source of truth is DB session.
 */
import React, { createContext, useContext, useCallback, useRef, useState } from "react"
import { useSession } from "./SessionContext"
import { getMockStep } from "../mocks/mockMode"
import { updateSessionInsuranceProducts, type SessionData } from "../api/session"
import { API_BASE } from "../api"

type LeadLoadingContextValue = {
  /** True while /lead is in flight; overlay should be visible. Dismisses only when lead returns. */
  leadLoading: boolean
}

const LeadLoadingContext = createContext<LeadLoadingContextValue | null>(null)

const DEV = typeof import.meta !== "undefined" && import.meta.env?.DEV

const requestedLeadSessions = new Set<string>()

function hasRequestedLead(sessionId: string) {
  if (requestedLeadSessions.has(sessionId)) return true
  try {
    return window.sessionStorage.getItem(`lead_requested:${sessionId}`) === "1"
  } catch {
    return false
  }
}

function markRequestedLead(sessionId: string) {
  requestedLeadSessions.add(sessionId)
  try {
    window.sessionStorage.setItem(`lead_requested:${sessionId}`, "1")
  } catch {
    // ignore
  }
}

export function LeadLoadingProvider({ children }: { children: React.ReactNode }) {
  const { state, refetch, setSession } = useSession()
  const [leadLoading, setLeadLoading] = useState(false)
  const inFlightRef = useRef(false)
  const didLogSkipRef = useRef(false)
  const didLogCallRef = useRef(false)

  const runLeadIfNeeded = useCallback(async () => {
    if (getMockStep() || state.status !== "ready" || !state.session) return
    const session = state.session as Record<string, unknown>
    const leadId = session.lead_id as string | undefined
    const quoteDetailId = session.quote_detail_id as string | undefined

    if (leadId && quoteDetailId) {
      if (DEV && !didLogSkipRef.current) {
        didLogSkipRef.current = true
        console.log("[Lead] Skip: already has ids or lead already requested:", session.session_id)
      }
      return
    }

    const sessionId = String(session.session_id ?? "")
    if (!sessionId) return

    if (hasRequestedLead(sessionId)) {
      if (DEV && !didLogSkipRef.current) {
        didLogSkipRef.current = true
        console.log("[Lead] Skip: already has ids or lead already requested:", sessionId)
      }
      return
    }

    if (inFlightRef.current) return

    // 2B) Validate required fields BEFORE latching (don't mark requested if payload is missing)
    const owner = session.owner as Record<string, unknown> | undefined
    const pet = session.pet as Record<string, unknown> | undefined
    const zipCode = (pet?.zip_code ?? owner?.zip_code ?? "") as string
    const petName = (pet?.name ?? "") as string
    const birthMonth = pet?.birth_month as number | undefined
    const birthYear = pet?.birth_year as number | undefined
    let dateOfBirth = ""
    if (birthYear && birthMonth) {
      dateOfBirth = `${birthYear}-${String(birthMonth).padStart(2, "0")}-01`
    } else if (birthYear) {
      dateOfBirth = `${birthYear}-01-01`
    }
    const email = (owner?.email ?? "") as string
    if (!zipCode || !petName || !dateOfBirth || !email) {
      return
    }

    // 2C) Latch first, then call
    markRequestedLead(sessionId)
    inFlightRef.current = true
    setLeadLoading(true)
    if (DEV && !didLogCallRef.current) {
      didLogCallRef.current = true
      console.log("[Lead] Calling /api/enrollment/lead for session_id:", sessionId)
    }

    const controller = new AbortController()
    const failsafe = window.setTimeout(() => {
      setLeadLoading(false)
      controller.abort()
    }, 60000)

    try {
      const res = await fetch(`${API_BASE}/api/enrollment/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          affiliateCode: "FLEXEMBD",
          zipCode,
          pets: [{
            name: petName,
            speciesType: ((pet?.type || "dog") as string).toUpperCase(),
            breedType: String(pet?.breed_id ?? ""),
            dateOfBirth,
            genderType: ((pet?.sex || "male") as string).toUpperCase(),
          }],
          attributionMetadata: {
            email,
            ...(owner?.first_name ? { firstName: String(owner.first_name) } : {}),
            ...(owner?.last_name ? { lastName: String(owner.last_name) } : {}),
            ...(owner?.phone ? { phoneNumber: String(owner.phone) } : {}),
          },
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        return
      }

      const data = (await res.json()) as Record<string, unknown>
      const returnedLeadId = (data.leadId ?? data.lead_id) as string | undefined
      const quotes = (data.quotes ?? []) as Array<Record<string, unknown>>
      let quoteDetailId: string | undefined
      let planId: string | undefined
      for (const quote of quotes) {
        const quotePets = (quote.pets ?? []) as Array<Record<string, unknown>>
        for (const qp of quotePets) {
          if (!quoteDetailId) quoteDetailId = (qp.quoteDetailId ?? qp.quote_detail_id) as string | undefined
          const pricing = (qp.pricing ?? {}) as Record<string, unknown>
          if (pricing.isDefaultPlan && quote.planId) planId = quote.planId as string
        }
      }
      if (!planId && quotes[0]?.planId) planId = quotes[0].planId as string
      if (!planId) planId = (data.planId ?? data.plan_id) as string | undefined

      const insuranceProducts: unknown[] = []
      const hpPlanIds: string[] = []
      for (const quote of quotes) {
        const quotePets = (quote.pets ?? []) as Array<Record<string, unknown>>
        if (quotePets.length === 0) continue
        const pricing = (quotePets[0].pricing ?? {}) as Record<string, unknown>
        const deductible = (quote.annualDeductibleUsd as number) ?? 500
        const reimbursementPct = (quote.reimbursementPercentage as number) ?? 80
        const monthlyRaw = (pricing.monthlyPriceUsd ?? pricing.firstYearMonthlyPriceUsd ?? 0) as number
        const monthlyPrice = typeof monthlyRaw === "number"
          ? monthlyRaw.toFixed(2)
          : parseFloat(String(monthlyRaw || 0)).toFixed(2)
        const quotePlanId = (quote.planId ?? planId ?? "70_500") as string
        if (quote.planId) hpPlanIds.push(String(quote.planId))
        // Extract isHighDeductible from pricing (HP determines Signature vs Value)
        // HP returns it in pricing.isHighDeductible, not at quote level
        const isHighDeductible = (pricing.isHighDeductible ?? pricing.is_high_deductible ?? false) as boolean
        insuranceProducts.push({
          deductible,
          reimbursement: reimbursementPct / 100,
          monthly_premium: monthlyPrice,
          plan_id: quotePlanId,
          isDefaultPlan: pricing.isDefaultPlan ?? false,
          isHighDeductible,
        })
      }
      if (insuranceProducts.length === 0) {
        insuranceProducts.push({
          deductible: 500,
          reimbursement: 0.8,
          monthly_premium: "34.99",
          plan_id: planId ?? "70_500",
          isDefaultPlan: false,
          isHighDeductible: false, // Default to Signature plan
        })
      }

      // Log frontend transformation before PATCH
      const computedPlanIds = insuranceProducts.map((p: any) => p?.plan_id).filter(Boolean)
      const reimbursement70Products = insuranceProducts.filter(
        (p: any) => p?.reimbursement === 0.7 || p?.reimbursement === 70
      )
      const deductiblePremiumPairs = reimbursement70Products
        .map((p: any) => `${p.deductible}->${p.monthly_premium}`)
        .sort()
      
      if (DEV) {
        console.log(
          `[LeadLoadingContext] Transforming HP quotes to insurance_products:`,
          {
            hpPlanIds,
            computedPlanIds,
            productsCount: insuranceProducts.length,
            reimbursement70Bucket: deductiblePremiumPairs,
            synthesized: insuranceProducts.length === 0 || hpPlanIds.length === 0,
          }
        )
      }

      await updateSessionInsuranceProducts(
        session.session_id as string,
        insuranceProducts,
        { leadId: returnedLeadId, quoteDetailId }
      )
      // Optimistic update so session.lead_id and session.quote_detail_id are available immediately
      setSession({
        ...session,
        lead_id: returnedLeadId ?? undefined,
        quote_detail_id: quoteDetailId,
        insurance_products: insuranceProducts,
      } as SessionData)
      const fetched = await refetch()
      // If GET doesn't return lead_id/quote_detail_id (e.g. backend not yet returning them),
      // re-apply so we never lose them after refetch overwrites state
      if (fetched && (returnedLeadId != null || quoteDetailId != null)) {
        setSession({
          ...fetched,
          lead_id: returnedLeadId ?? (fetched.lead_id ?? undefined),
          quote_detail_id: quoteDetailId ?? (fetched.quote_detail_id ?? undefined),
          insurance_products: insuranceProducts,
        } as SessionData)
      }
    } catch (e) {
      if (DEV) console.warn("[Lead] lead or session update failed:", e)
    } finally {
      window.clearTimeout(failsafe)
      setLeadLoading(false)
      inFlightRef.current = false
    }
  }, [state.status, state.status === "ready" ? (state as { session: Record<string, unknown> }).session?.session_id : undefined, refetch])

  const session = state.status === "ready" ? (state as { session: Record<string, unknown> }).session : undefined
  React.useEffect(() => {
    if (!session) return
    runLeadIfNeeded()
  }, [session?.session_id, runLeadIfNeeded])

  const value: LeadLoadingContextValue = { leadLoading }

  return (
    <LeadLoadingContext.Provider value={value}>
      {children}
    </LeadLoadingContext.Provider>
  )
}

export function useLeadLoading(): LeadLoadingContextValue {
  const ctx = useContext(LeadLoadingContext)
  if (!ctx) return { leadLoading: false }
  return ctx
}
