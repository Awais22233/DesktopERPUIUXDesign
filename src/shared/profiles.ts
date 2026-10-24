export type ProfileId = "cloth" | "cosmetics"
export type FlagKey = "than" | "recovery" | "cityWise" | "wholesalePrice" | "barcode" | "batch" | "expiry" | "profit"
export type Flags = Record<FlagKey, boolean>

export const FLAG_KEYS: FlagKey[] = ["than", "recovery", "cityWise", "wholesalePrice", "barcode", "batch", "expiry", "profit"]

export const profiles: Record<ProfileId, { name: string; flags: Flags }> = {
  cloth: {
    name: "Cloth Wholesale",
    flags: { than: true, recovery: true, cityWise: true, wholesalePrice: true, barcode: false, batch: false, expiry: false, profit: false },
  },
  cosmetics: {
    name: "Cosmetics",
    flags: { than: false, recovery: true, cityWise: false, wholesalePrice: false, barcode: true, batch: true, expiry: true, profit: true },
  },
}

/** Reports that show profit or cost. They are refused (and not listed) while the "profit" feature is off. */
export const PROFIT_REPORTS = [
  "Profit & Loss", "Daily Profit", "Monthly Profit", "Company Profitability", "Category Profitability", "Customer Profitability", "City Profitability", "Stock Valuation",
]

export function isProfileId(value: unknown): value is ProfileId {
  return value === "cloth" || value === "cosmetics"
}
