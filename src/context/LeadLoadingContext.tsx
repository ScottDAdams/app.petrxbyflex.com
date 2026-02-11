/**
 * Lead loading: /api/enrollment/lead is called when session has no lead_id/quote_detail_id
 * and required pet/owner fields. Overlay shows until lead returns (success or handled failure).
 * Source of truth is DB; no browser persistence (no sessionStorage/localStorage) for lead gating.
 */
import React, { createContext, useContext, useCallback, useRef, useState } from "react"
import { useSession } from "./SessionContext"
import { getMockStep } from "../mocks/mockMode"
import { updateSessionInsuranceProducts, type SessionData } from "../api/session"
import { API_BASE } from "../api"

type LeadLoadingContextValue = {
  /** True while /lead is in flight; overlay should be visible. Dismisses only when lead returns. */
  leadLoading: boolean
  /** Call to retry CreateLead (e.g. after 11014 "Try again"). No-op if already in flight or has lead data. */
  retryLead: () => void
}

const LeadLoadingContext = createContext<LeadLoadingContextValue | null>(null)

const DEV = typeof import.meta !== "undefined" && import.meta.env?.DEV

function isDebug(): boolean {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get("debug") === "1"
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
        console.log("[Lead] Skip: already has lead_id and quote_detail_id:", session.session_id)
      }
      return
    }

    const sessionId = String(session.session_id ?? "")
    if (!sessionId) return

    const hasLeadData = leadId != null || (Array.isArray(session.insurance_products) && session.insurance_products.length > 0)
    if (hasLeadData) {
      if (DEV && !didLogSkipRef.current) {
        didLogSkipRef.current = true
        console.log("[Lead] Skip: session already has lead data:", sessionId)
      }
      return
    }

    if (inFlightRef.current) return

    const owner = session.owner as Record<string, unknown> | undefined
    const pet = session.pet as Record<string, unknown> | undefined
    const zipCode = (pet?.zip_code ?? owner?.zip ?? "") as string
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
          session_id: sessionId,
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

      const data = (await res.json()) as Record<string, unknown>

      // Backend returns 200 with status=resume_available or lead_failed on HP error (e.g. 11014); session is hydrated
      if (res.ok && (data.status === "resume_available" || data.status === "lead_failed") && data.session) {
        if (isDebug()) {
          console.log("[Lead]", data.status, "retrieve_quote_url:", !!data.retrieve_quote_url, "resume_session_id:", !!data.resume_session_id)
        }
        setSession(data.session as SessionData)
        return
      }

      if (!res.ok) {
        return
      }

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
          isHighDeductible: false,
        })
      }

      if (DEV) {
        console.log(
          `[LeadLoadingContext] Transforming HP quotes to insurance_products:`,
          { hpPlanIds, productsCount: insuranceProducts.length }
        )
      }

      await updateSessionInsuranceProducts(
        session.session_id as string,
        insuranceProducts,
        { leadId: returnedLeadId, quoteDetailId }
      )
      setSession({
        ...session,
        lead_id: returnedLeadId ?? undefined,
        quote_detail_id: quoteDetailId,
        insurance_products: insuranceProducts,
      } as SessionData)
      const fetched = await refetch()
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
  }, [state.status, state.status === "ready" ? (state as { session: Record<string, unknown> }).session?.session_id : undefined, refetch, setSession])

  const session = state.status === "ready" ? (state as { session: Record<string, unknown> }).session : undefined
  React.useEffect(() => {
    if (!session) return
    runLeadIfNeeded()
  }, [session?.session_id, runLeadIfNeeded])

  const value: LeadLoadingContextValue = { leadLoading, retryLead: runLeadIfNeeded }

  return (
    <LeadLoadingContext.Provider value={value}>
      {children}
    </LeadLoadingContext.Provider>
  )
}

export function useLeadLoading(): LeadLoadingContextValue {
  const ctx = useContext(LeadLoadingContext)
  if (!ctx) return { leadLoading: false, retryLead: () => {} }
  return ctx
}
