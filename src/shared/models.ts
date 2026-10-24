/**
 * View models the UI works with. Amounts are in rupees (the engine stores paisa and converts at the boundary).
 * Ids are display ids such as "PTY-0007"; the numeric part is the database id.
 */
export type Party = {
  id: string
  name: string
  city: string
  phone: string
  whatsapp?: string
  area?: string
  address?: string
  notes?: string
  terms?: number
  balance: number
  limit: number
  status: string
}
export type Product = {
  id: string
  name: string
  company: string
  category: string
  article: string
  color: string
  design?: string
  size: string
  /** cloth: length of one than in meters (null = not sold by the meter). Prices are then per meter. */
  length: number | null
  unit: string
  barcode?: string
  sku?: string
  stock: number
  /** average cost of the stock in hand (falls back to the purchase price) */
  cost: number
  /** the latest supplier price: what a new purchase and the product form start from */
  purchasePrice: number
  /** the sale price */
  rate: number
  /** what the sales screen charges by default: the wholesale price when that feature is on and set, otherwise the sale price */
  price: number
  wholesale?: number
  minStock: number
  expiry?: string
  active: boolean
  /** base name of the stored photo (see imageUrl), when the product has one */
  image?: string
}
export type CartItem = { productId: string; name: string; color: string; size: string; /** stable key of a cart line when one product is on the bill in several lengths */ uid?: string; /** meters of one than; on a bill line `rate` is per than and `rateM` per meter */ length?: number; rateM?: number; qty: number; rate: number; discount: number; batchNo?: string; mfgDate?: string; expiryDate?: string }
export type Transaction = {
  id: string
  /** which book the document belongs to (set by the engine) */
  kind?: "sale" | "purchase"
  party: string
  partyId?: string
  date: string
  items: number
  total: number
  paid: number
  method: string
  lines?: CartItem[]
  account?: string
  supplierInvoice?: string
  invoiceDiscount?: number
  status?: "completed" | "void"
  user?: string
  /** time of day the bill was made (business time) */
  time?: string
  /** the party's balance just before and after this bill (positive = they owe us / we owe them) */
  balanceBefore?: number
  balanceAfter?: number
  walkIn?: boolean
}
export type Collection = { id: string; party: string; amount: number; method: string; account: string; date: string; time: string; user: string; notes: string; balanceBefore?: number; balanceAfter?: number }
export type Expense = { id: string; category: string; amount: number; account: string; date: string; notes: string; user: string }
export type Movement = { id: string; date: string; type: string; quantity: number; productId: string; reason: string }
export type AccountEntry = { id: string; date: string; account: string; description: string; incoming: number; outgoing: number; type: string }
export type AppUser = { id: string; name: string; username: string; role: string; status: string; activity: string }
export type Audit = { id: string; date: string; action: string; detail: string; user: string }
export type ReturnRow = { id: string; original: string; type: string; total: number; date: string; party: string }
export type Closing = { id: string; date: string; account: string; expected: number; counted: number; variance: number; notes: string; user: string }

export type Masters = {
  accounts: { id: number; name: string; type: "cash" | "bank"; balance: number; active: boolean }[]
  expenseCategories: string[]
  companies: string[]
  categories: { name: string; sub: string[] }[]
  cities: string[]
  thanSizes: string[]
  paymentMethods: string[]
  roles: { name: string; system: boolean; permissions: string[] }[]
  sequences: { kind: string; prefix: string; next: number }[]
  settings: Record<string, string>
}

export type Snapshot = {
  today: string
  historyFrom: string
  walkInId: string
  parties: Party[]
  suppliers: Party[]
  collections: Collection[]
  expenses: Expense[]
  accounts: Record<string, number>
  entries: AccountEntry[]
  users: AppUser[]
  audits: Audit[]
  returns: ReturnRow[]
  closings: Closing[]
  masters: Masters
  dashboard: DashboardData
}

export type DashboardData = {
  todaySales: number
  todaySalesCount: number
  todayRecovery: number
  todayRecoveryCount: number
  todayPurchases: number
  todayPurchaseCount: number
  todayExpenses: number
  grossProfit: number
  /** percent of net sales, or null when there were no sales */
  margin: number | null
  receivables: number
  payables: number
  stockValue: number
  receivedCash: number
  receivedBank: number
  salesReceived: number
  week: { label: string; value: number }[]
  weekPrev: number
  month: { label: string; value: number }[]
  monthPrev: number
  inventory: { items: number; units: number; value: number; low: number; out: number; reorder: number }
  lowStock: Product[]
  recentSales: Transaction[]
  recentPurchases: Transaction[]
  expiring: { product: string; batch: string; expiry: string; qty: number; days: number }[]
  cities: { city: string; sales: number; recovery: number; outstanding: number; parties: number }[]
  /** Which first-day steps are already done, for the "Getting started" checklist. */
  setup: { shopDetails: boolean; money: boolean; parties: boolean; products: boolean; firstSale: boolean }
}

export type LedgerRow = { id: number; date: string; ref: string; description: string; debit: number; credit: number; balance: number }
export type LedgerView = { rows: LedgerRow[]; aging: number[] }

export type ReportResult = {
  columns: { key: string; label: string; kind?: "money" | "number" | "text" }[]
  rows: Record<string, string | number>[]
  summary: { label: string; value: number | string; kind: "money" | "number" | "text"; tone?: string }[]
  note?: string
}

export type SessionUser = { id: number; name: string; username: string; role: string; permissions: string[] }

export const idNumber = (id: string): number => {
  const n = Number(id.split("-").pop())
  if (!Number.isInteger(n) || n <= 0) throw new Error(`Invalid id: ${id}`)
  return n
}
export const fmtId = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, "0")}`

/** The settings the UI may change. Anything else is refused by the main process. */
export const SETTING_KEYS = [
  "credit.limit_mode",
  "sales.max_discount_percent",
  "stock.allow_negative",
  "receipts.allow_overpayment",
  "returns.window_days",
  "timezone_offset_minutes",
  "backup.secondary_dir",
  "than.sizes",
  "payment.methods",
  "invoice.layout",
  "print.thermal_width",
  "expiry.warning_days",
] as const
