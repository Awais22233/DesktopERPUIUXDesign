import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import type { Business } from "@shared/ipc"

export type { Business }

const EMPTY: Business = { name: "", tagline: "", owner: "", phone: "", email: "", address: "", city: "", logo: "", invoiceFooter: "", accent: "navy" }

type BusinessValue = {
  business: Business
  /** Resolves to an error message, or null on success. */
  saveBusiness: (b: Business) => Promise<string | null>
}
const BusinessContext = createContext<BusinessValue | null>(null)

export function BusinessProvider({ children }: { children: ReactNode }) {
  const [business, setBusiness] = useState<Business>(EMPTY)

  useEffect(() => {
    let alive = true
    void window.api?.invoke("business:get").then((r) => {
      if (alive && r.ok) setBusiness(r.data)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    document.title = business.name || "Wholesale ERP"
  }, [business.name])

  useEffect(() => {
    document.documentElement.dataset.accent = business.accent
  }, [business.accent])

  const saveBusiness = useCallback(async (b: Business) => {
    if (window.api) {
      const r = await window.api.invoke("business:set", b)
      if (!r.ok) return r.error.message
      setBusiness(r.data)
      return null
    }
    setBusiness(b)
    return null
  }, [])

  const value = useMemo(() => ({ business, saveBusiness }), [business, saveBusiness])
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export function useBusiness() {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error("useBusiness must be used inside BusinessProvider")
  return ctx
}

/** The logo if one was uploaded, otherwise the default mark. */
export function BrandMark({ logo, className = "" }: { logo?: string; className?: string }) {
  if (logo) {
    return (
      <span className={`brand-mark has-logo ${className}`}>
        <img src={logo} alt="" />
      </span>
    )
  }
  return (
    <span className={`brand-mark ${className}`}>
      <span />
      <span />
      <span />
    </span>
  )
}

/** "Raza Textiles" -> ["Raza", "Textiles"] for the two-tone sidebar name. */
export function nameParts(name: string): [string, string] {
  const i = name.indexOf(" ")
  return i < 0 ? [name, ""] : [name.slice(0, i), name.slice(i + 1)]
}
