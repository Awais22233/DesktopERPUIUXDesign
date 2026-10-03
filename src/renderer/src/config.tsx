import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { profiles, type FlagKey, type Flags, type ProfileId } from "@shared/profiles"

export { profiles }
export type { FlagKey, Flags, ProfileId }

/** Features shown in Settings > Features. `wired` = already controls the UI. */
export const featureMeta: { key: FlagKey; title: string; description: string; wired: boolean }[] = [
  { key: "than", title: "Than", description: "Than size label and than-based sales and stock", wired: true },
  { key: "recovery", title: "Recovery", description: "Daily collection screen and recovery reports", wired: true },
  { key: "cityWise", title: "City-wise analysis", description: "City on party and city-wise reports", wired: false },
  { key: "wholesalePrice", title: "Wholesale price", description: "Second price on every variant", wired: false },
  { key: "barcode", title: "Barcode", description: "Scan to add items in the sales screen", wired: false },
  { key: "batch", title: "Batch", description: "Batch number and manufacturing date", wired: false },
  { key: "expiry", title: "Expiry alerts", description: "Admin alerts for items near expiry", wired: false },
]

type Saved = { profile: ProfileId; flags: Flags }
const KEY = "raza-config"

/** Browser-only fallback (plain `vite` preview). In the desktop app the database is the source of truth. */
function loadLocal(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null")
    if (raw && raw.profile in profiles) return { profile: raw.profile, flags: { ...profiles[raw.profile as ProfileId].flags, ...raw.flags } }
  } catch {
    /* default below */
  }
  return { profile: "cloth", flags: { ...profiles.cloth.flags } }
}

type ConfigValue = {
  profile: ProfileId
  flags: Flags
  isEnabled: (flag: FlagKey) => boolean
  /** Resolve to an error message when the change is refused, otherwise null. */
  setProfile: (profile: ProfileId) => Promise<string | null>
  setFlag: (flag: FlagKey, value: boolean) => Promise<string | null>
}

const ConfigContext = createContext<ConfigValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Saved>(loadLocal)

  useEffect(() => {
    let alive = true
    void window.api?.invoke("config:get").then((r) => {
      if (alive && r.ok) setState(r.data)
    })
    return () => {
      alive = false
    }
  }, [])

  const applyLocal = (next: Saved) => {
    setState(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* in-memory only */
    }
  }

  const setProfile = useCallback(async (profile: ProfileId) => {
    if (window.api) return "The business type is set by your license and cannot be changed here."
    applyLocal({ profile, flags: { ...profiles[profile].flags } })
    return null
  }, [])

  const setFlag = useCallback(
    async (flag: FlagKey, value: boolean) => {
      if (window.api) {
        const r = await window.api.invoke("config:setFlag", { flag, enabled: value })
        if (!r.ok) return r.error.message
        setState(r.data)
        return null
      }
      applyLocal({ ...state, flags: { ...state.flags, [flag]: value } })
      return null
    },
    [state],
  )

  const value = useMemo<ConfigValue>(() => ({ ...state, isEnabled: (f) => state.flags[f], setProfile, setFlag }), [state, setProfile, setFlag])
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider")
  return ctx
}
