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
  unit: string
  barcode?: string
  sku?: string
  stock: number
  cost: number
  rate: number
  wholesale?: number
  minStock: number
  expiry?: string
  active: boolean
}
export type CartItem = { productId: string; name: string; color: string; size: string; qty: number; rate: number; discount: number }
export type Transaction = {
  id: string
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
}
export type Collection = { id: string; party: string; amount: number; method: string; account: string; date: string; time: string; user: string; notes: string }
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
  products: Product[]
  sales: Transaction[]
  purchases: Transaction[]
  collections: Collection[]
  expenses: Expense[]
  movements: Movement[]
  accounts: Record<string, number>
  entries: AccountEntry[]
  users: AppUser[]
  audits: Audit[]
  returns: ReturnRow[]
  closings: Closing[]
  masters: Masters
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
