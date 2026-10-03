import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type ProfileId = "cloth" | "cosmetics"
export type FlagKey = "than" | "recovery" | "cityWise" | "wholesalePrice" | "barcode" | "batch" | "expiry"
export type Flags = Record<FlagKey, boolean>

export const profiles: Record<ProfileId, { name: string; flags: Flags }> = {
  cloth: {
    name: "Cloth Wholesale",
    flags: {
      than: true,
      recovery: true,
      cityWise: true,
      wholesalePrice: true,
      barcode: false,
      batch: false,
      expiry: false,
    },
  },
  cosmetics: {
    name: "Cosmetics",
    flags: {
      than: false,
      recovery: false,
      cityWise: false,
      wholesalePrice: false,
      barcode: true,
      batch: true,
      expiry: true,
    },
  },
}

/** Features shown in Settings > Features. `wired` = already controls the UI. */
export const featureMeta: {
  key: FlagKey
  title: string
  description: string
  wired: boolean
}[] = [
  {
    key: "than",
    title: "Than",
    description: "Than size label and than-based sales and stock",
    wired: true,
  },
  {
    key: "recovery",
    title: "Recovery",
    description: "Daily collection screen and recovery reports",
    wired: true,
  },
  {
    key: "cityWise",
    title: "City-wise analysis",
    description: "City on party and city-wise reports",
    wired: false,
  },
  {
    key: "wholesalePrice",
    title: "Wholesale price",
    description: "Second price on every variant",
    wired: false,
  },
  {
    key: "barcode",
    title: "Barcode",
    description: "Scan to add items in the sales screen",
    wired: false,
  },
  {
    key: "batch",
    title: "Batch",
    description: "Batch number and manufacturing date",
    wired: false,
  },
  {
    key: "expiry",
    title: "Expiry alerts",
    description: "Admin alerts for items near expiry",
    wired: false,
  },
]

type Saved = { profile: ProfileId; flags: Flags }
const KEY = "raza-config"

function load(): Saved {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null")
    if (raw && raw.profile in profiles) {
      return {
        profile: raw.profile,
        flags: { ...profiles[(raw.profile as ProfileId)].flags, ...raw.flags },
      }
    }
  } catch {
    /* fall through to default */
  }
  return { profile: "cloth", flags: { ...profiles.cloth.flags } }
}

type ConfigValue = {
  profile: ProfileId
  flags: Flags
  isEnabled: (flag: FlagKey) => boolean
  setProfile: (profile: ProfileId) => void
  setFlag: (flag: FlagKey, value: boolean) => void
}

const ConfigContext = createContext<ConfigValue | null>(null)

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Saved>(load)
  const persist = (next: Saved) => {
    setState(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* storage unavailable: keep in memory */
    }
  }
  const setProfile = useCallback((profile: ProfileId) => {
    persist({ profile, flags: { ...profiles[profile].flags } })
  }, [])
  const setFlag = useCallback(
    (flag: FlagKey, value: boolean) => {
      persist({ ...state, flags: { ...state.flags, [flag]: value } })
    },
    [state],
  )
  const value = useMemo<ConfigValue>(
    () => ({
      ...state,
      isEnabled: (flag) => state.flags[flag],
      setProfile,
      setFlag,
    }),
    [state, setProfile, setFlag],
  )
  return (
    <ConfigContext.Provider value={value}>{children}</ConfigContext.Provider>
  )
}

export function useConfig() {
  const ctx = useContext(ConfigContext)
  if (!ctx) throw new Error("useConfig must be used inside ConfigProvider")
  return ctx
}
