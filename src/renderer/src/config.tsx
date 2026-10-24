import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { profiles, type FlagKey, type Flags, type ProfileId } from "@shared/profiles"
import { applyLabels } from "./data"
import { api } from "./backend"

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
  { key: "profit", title: "Show profit and cost", description: "Profit, margin, average cost and stock value at cost. Off hides them everywhere.", wired: true },
  { key: "expiry", title: "Expiry alerts", description: "Admin alerts for items near expiry", wired: false },
]

type Saved = { profile: ProfileId; flags: Flags }

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
  const [state, setState] = useState<Saved>({ profile: "cloth", flags: { ...profiles.cloth.flags } })
  applyLabels(state.flags.than)

  useEffect(() => {
    let alive = true
    void api("config:get")
      .then((cfg) => alive && setState(cfg))
      .catch(() => null)
    return () => {
      alive = false
    }
  }, [])

  const setProfile = useCallback(async () => "The business type is set by your license and cannot be changed here.", [])
  const setFlag = useCallback(async (flag: FlagKey, value: boolean) => {
    try {
      setState(await api("config:setFlag", { flag, enabled: value }))
      return null
    } catch (e) {
      return (e as Error).message
    }
  }, [])

  const value = useMemo<ConfigValue>(() => ({ ...state, isEnabled: (f) => state.flags[f], setProfile, setFlag }), [state, setProfile, setFlag])
  return <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
}

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider")
  return ctx
}
