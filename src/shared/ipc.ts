import type { Flags, FlagKey, ProfileId } from "./profiles"

export interface AppConfig {
  profile: ProfileId
  flags: Flags
}
export interface Business {
  name: string
  tagline: string
  owner: string
  phone: string
  email: string
  address: string
  city: string
  /** data: URL of a small PNG/JPG/WebP/SVG, or "" for the default mark. */
  logo: string
  invoiceFooter: string
  /** Accent colour of the screens: navy (the approved default), green, teal, purple or maroon. */
  accent: "navy" | "green" | "teal" | "purple" | "maroon"
}

export type LicenseState = "valid" | "missing" | "invalid" | "expired" | "wrong_machine" | "clock_tampered" | "wrong_profile"
export interface LicenseStatus {
  state: LicenseState
  machineId: string
  message: string
  client?: string
  profile?: ProfileId
  licenseId?: string
  issuedAt?: string
  expiresAt?: string | null
}

export interface BackupInfo {
  name: string
  size: number
  modified: string
}

import type { Snapshot, SessionUser, LedgerView, ReportResult, Product, Transaction, Movement } from "./models"

type Id = string

export interface LineIn { productId: Id; qty: number; rate?: number; discount?: number; batchNo?: string; mfgDate?: string; expiryDate?: string }
export interface PayIn { account: string; method: string; amount: number }

/** Single source of truth for the renderer <-> main contract. Amounts are rupees (converted to paisa in main). */
export interface IpcContract {
  "app:info": { req: undefined; res: { version: string; dataDir: string; schemaVersion: number; packaged: boolean } }
  "license:status": { req: undefined; res: LicenseStatus }
  "license:activate": { req: { key: string }; res: LicenseStatus }
  "auth:status": { req: undefined; res: { setupNeeded: boolean; user: SessionUser | null } }
  "auth:setup": { req: { name: string; username: string; password: string }; res: SessionUser }
  "auth:login": { req: { username: string; password: string }; res: SessionUser }
  "auth:logout": { req: undefined; res: null }
  "auth:changePassword": { req: { current: string; next: string }; res: null }
  "snapshot:get": { req: undefined; res: Snapshot }
  "products:list": { req: { query?: string; status?: "all" | "in" | "low" | "out" | "inactive"; page?: number; pageSize?: number; activeOnly?: boolean; ids?: Id[] }; res: { rows: Product[]; total: number; page: number; pageSize: number; summary: { items: number; units: number; value: number; low: number; out: number; reorder: number } } }
  "docs:list": { req: { kind: "sale" | "purchase"; query?: string; status?: "all" | "completed" | "void"; page?: number; pageSize?: number; no?: string; partyId?: Id; payment?: "paid" | "partial" | "unpaid" }; res: { rows: Transaction[]; total: number; page: number; pageSize: number; summary: { count: number; total: number; paid: number } } }
  "movements:list": { req: { productId?: Id; page?: number; pageSize?: number }; res: { rows: Movement[]; total: number; page: number; pageSize: number } }
  "report:run": { req: { name: string; from: string; to: string; filter?: string }; res: ReportResult }
  "ledger:get": { req: { kind: "customer" | "supplier"; id: Id }; res: LedgerView }
  "business:get": { req: undefined; res: Business }
  "business:set": { req: Business; res: Business }
  "config:get": { req: undefined; res: AppConfig }
  "config:setFlag": { req: { flag: FlagKey; enabled: boolean }; res: AppConfig }
  "sale:create": { req: { partyId: Id; lines: LineIn[]; discount?: number; payments: PayIn[]; notes?: string; overrideCreditLimit?: boolean; date?: string }; res: { id: string; warnings: string[] } }
  "purchase:create": { req: { supplierId: Id; supplierInvoice?: string; lines: LineIn[]; discount?: number; payments: PayIn[]; notes?: string; date?: string }; res: { id: string } }
  "sale:void": { req: { id: string; reason: string }; res: null }
  "purchase:void": { req: { id: string; reason: string }; res: null }
  "receipt:create": { req: { partyId: Id; account: string; method: string; amount: number; date?: string; notes?: string; receivedBy?: string }; res: { id: string } }
  "supplierPayment:create": { req: { partyId: Id; account: string; method: string; amount: number; date?: string; notes?: string }; res: { id: string } }
  "expense:create": { req: { category: string; amount: number; account: string; date?: string; notes?: string }; res: null }
  "transfer:create": { req: { from: string; to: string; amount: number; date?: string; notes?: string }; res: null }
  "stock:adjust": { req: { productId: Id; quantity: number; reason: string; notes?: string; damage?: boolean }; res: null }
  "stock:count": { req: { lines: { productId: Id; counted: number }[]; note?: string }; res: { adjusted: number } }
  "opening:party": { req: { kind: "customer" | "supplier"; id: Id; amount: number }; res: null }
  "opening:account": { req: { account: string; amount: number }; res: null }
  "opening:stock": { req: { productId: Id; qty: number; cost: number }; res: null }
  "party:save": { req: { kind: "customer" | "supplier"; id?: Id; name: string; city?: string; phone?: string; whatsapp?: string; area?: string; address?: string; notes?: string; limit?: number; terms?: number | null; active?: boolean; openingBalance?: number }; res: { id: string } }
  "product:save": { req: { id?: Id; company: string; article: string; category?: string; subcategory?: string; color?: string; design?: string; size?: string; unit?: string; barcode?: string; sku?: string; cost: number; rate: number; wholesale?: number | null; minStock?: number; active?: boolean; openingQty?: number }; res: { id: string } }
  "product:colors": { req: { company: string; article: string; category?: string; subcategory?: string; design?: string; size?: string; unit?: string; cost: number; rate: number; wholesale?: number | null; minStock?: number; colors: { color: string; openingQty?: number }[] }; res: { created: string[]; skipped: string[] } }
  "colours:list": { req: undefined; res: { id: number; name: string; hex: string | null; uses: number }[] }
  "colour:save": { req: { id?: number; name: string; hex?: string | null }; res: { id: number } }
  "colour:delete": { req: { id: number }; res: null }
  "product:image": { req: { id: Id; thumb?: string; full?: string }; res: null }
  "return:sale": { req: { invoice: string; quantities: Record<string, number>; settlement: "balance" | "cash"; account?: string; refund?: number; damaged?: boolean; reason?: string }; res: { id: string; total: number } }
  "return:purchase": { req: { purchase: string; quantities: Record<string, number>; refund?: number; account?: string; reason?: string }; res: { id: string; total: number } }
  "exchange:create": { req: { invoice: string; quantities: Record<string, number>; partyId: Id; lines: LineIn[]; payments: PayIn[] }; res: { returnId: string; invoice: string } }
  "closing:create": { req: { account: string; date: string; counted: number; notes?: string }; res: { variance: number } }
  "master:add": { req: { kind: "expenseCategory" | "company" | "category" | "subcategory" | "city"; name: string; parent?: string }; res: null }
  "account:add": { req: { name: string; type: "cash" | "bank"; opening?: number }; res: null }
  "account:setActive": { req: { id: number; active: boolean }; res: null }
  "settings:set": { req: { key: string; value: string }; res: null }
  "sequence:set": { req: { kind: string; prefix: string }; res: null }
  "user:create": { req: { name: string; username: string; password: string; role: string }; res: null }
  "user:setActive": { req: { id: Id; active: boolean }; res: null }
  "user:resetPassword": { req: { id: Id; password: string }; res: null }
  "role:setPermission": { req: { role: string; permission: string; allowed: boolean }; res: null }
  "backup:run": { req: undefined; res: { name: string } }
  "backup:list": { req: undefined; res: BackupInfo[] }
  "backup:restore": { req: { name: string }; res: null }
  "backup:chooseFolder": { req: undefined; res: { folder: string | null } }
  "health:get": { req: undefined; res: { integrityOk: boolean; lastBackupAt: string | null; problems: string[] } }
}
export type Channel = keyof IpcContract
const CHANNEL_LIST = ["report:run", "ledger:get", "app:info", "license:status", "license:activate", "auth:status", "auth:setup", "auth:login", "auth:logout", "auth:changePassword", "snapshot:get", "products:list", "docs:list", "movements:list", "business:get", "business:set", "config:get", "config:setFlag", "sale:create", "purchase:create", "sale:void", "purchase:void", "receipt:create", "supplierPayment:create", "expense:create", "transfer:create", "stock:adjust", "stock:count", "opening:party", "opening:account", "opening:stock", "party:save", "product:save", "product:colors", "colours:list", "colour:save", "colour:delete", "product:image", "return:sale", "return:purchase", "exchange:create", "closing:create", "master:add", "account:add", "account:setActive", "settings:set", "sequence:set", "user:create", "user:setActive", "user:resetPassword", "role:setPermission", "backup:run", "backup:list", "backup:restore", "backup:chooseFolder", "health:get"] as Channel[]
export const CHANNELS: Channel[] = CHANNEL_LIST

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } }
