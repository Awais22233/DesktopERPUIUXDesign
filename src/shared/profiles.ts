export type ProfileId = "cloth" | "cosmetics"
export type FlagKey = "than" | "recovery" | "cityWise" | "wholesalePrice" | "barcode" | "batch" | "expiry"
export type Flags = Record<FlagKey, boolean>

export const FLAG_KEYS: FlagKey[] = ["than", "recovery", "cityWise", "wholesalePrice", "barcode", "batch", "expiry"]

export const profiles: Record<ProfileId, { name: string; flags: Flags }> = {
  cloth: {
    name: "Cloth Wholesale",
    flags: { than: true, recovery: true, cityWise: true, wholesalePrice: true, barcode: false, batch: false, expiry: false },
  },
  cosmetics: {
    name: "Cosmetics",
    flags: { than: false, recovery: true, cityWise: false, wholesalePrice: false, barcode: true, batch: true, expiry: true },
  },
}

export function isProfileId(value: unknown): value is ProfileId {
  return value === "cloth" || value === "cosmetics"
}
