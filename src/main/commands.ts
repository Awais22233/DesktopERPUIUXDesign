import type { DB } from "./db/connection"
import { AppError } from "@core/errors"
import { ALL_PERMISSIONS, PERMISSIONS, requirePermission, type Actor, type Permission } from "@core/permissions"
import type { Channel, IpcContract, LineIn, PayIn } from "@shared/ipc"
import { SETTING_KEYS, fmtId, idNumber } from "@shared/models"
import { audit, getSetting, setSetting, tx } from "./db/util"
import { hashPassword } from "./services/auth"
import { addAccount, addMaster, saveParty, saveProduct, saveProductColors, setAccountActive } from "./services/catalog"
import { removeProductImage, saveProductImage } from "./services/images"
import { postCashClosing, postStockCount } from "./services/closing"
import { adjustStock, postOpeningAccountBalance, postOpeningPartyBalance, postOpeningStock, postTransfer, recordExpense, recordReceipt, recordSupplierPayment } from "./services/payments"
import { postPurchase, voidPurchase } from "./services/purchases"
import { postExchange, postPurchaseReturn, postSaleReturn } from "./services/returns"
import { postSale, voidSale } from "./services/sales"
import { bizDate, buildSnapshot } from "./services/snapshot"
import { inventorySummary, listDocs, listMovements, listProducts } from "./services/lists"
import { ledgerView } from "./services/ledger"
import { runReport } from "./services/reports"
import { getBusiness, setBusiness } from "./services/business"
import { getConfig, setFlag } from "./services/config"
import type { Session } from "./session"
import type { BackupManager } from "./backupManager"

export interface Ctx {
  db: () => DB
  session: Session
  backups: () => BackupManager
  /** Replaces the live data file with a backup and restarts the application. */
  restore: (backupName: string) => Promise<void>
  chooseFolder: () => Promise<string | null>
  /** Folder for product photos (the data folder's images/ directory). */
  imagesDir?: string
}

type Handlers = { [C in Channel]?: (p: IpcContract[C]["req"]) => Promise<IpcContract[C]["res"]> | IpcContract[C]["res"] }

const paisa = (v: number | undefined | null, label = "Amount"): number => {
  if (v === undefined || v === null || !Number.isFinite(v)) throw new AppError("VALIDATION", `${label} is not a valid number`)
  const minor = v * 100
  // Money has two decimals (paisa). Silently rounding 1.005 would make the printed bill and the stored bill differ by a paisa.
  if (Math.abs(minor - Math.round(minor)) > 0.001 + Math.abs(minor) * 1e-12) throw new AppError("VALIDATION", `${label} can have at most 2 decimal places`)
  return Math.round(minor)
}
const optPaisa = (v: number | undefined | null) => (v === undefined || v === null ? undefined : paisa(v))

function accountId(db: DB, name: string): number {
  const r = db.prepare("SELECT id FROM accounts WHERE name = ?").get(name) as { id: number } | undefined
  if (!r) throw new AppError("NOT_FOUND", `Account "${name}" was not found`)
  return r.id
}

/** A chosen calendar date becomes a timestamp; today means "now". Older dates are checked by the services (backdate permission). */
function stamp(db: DB, date?: string): string | undefined {
  if (!date) return undefined
  const off = Number(getSetting(db, "timezone_offset_minutes", "300"))
  if (date === bizDate(new Date().toISOString(), off)) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError("VALIDATION", "Invalid date")
  return new Date(new Date(`${date}T12:00:00Z`).getTime() - off * 60_000).toISOString()
}

function batchFor(db: DB, variantId: number, l: LineIn): number | undefined {
  const no = l.batchNo?.trim()
  if (!no) return undefined
  const found = db.prepare("SELECT id FROM batches WHERE variant_id = ? AND batch_no = ?").get(variantId, no) as { id: number } | undefined
  if (found) return found.id
  return Number(db.prepare("INSERT INTO batches(variant_id, batch_no, mfg_date, expiry_date) VALUES (?,?,?,?)").run(variantId, no, l.mfgDate || null, l.expiryDate || null).lastInsertRowid)
}

const payments = (db: DB, p: PayIn[]) => p.filter((x) => x.amount > 0).map((x) => ({ accountId: accountId(db, x.account), method: x.method, amount: paisa(x.amount) }))

function docId(db: DB, table: "sales" | "purchases", no: string): number {
  const col = table === "sales" ? "invoice_no" : "purchase_no"
  const r = db.prepare(`SELECT id FROM ${table} WHERE ${col} = ?`).get(no) as { id: number } | undefined
  if (!r) throw new AppError("NOT_FOUND", `${no} was not found`)
  return r.id
}

function lineMap(db: DB, kind: "sale" | "purchase", docIdNum: number): Map<number, number> {
  const rows = db.prepare(kind === "sale" ? "SELECT id, variant_id FROM sale_lines WHERE sale_id = ? ORDER BY id" : "SELECT id, variant_id FROM purchase_lines WHERE purchase_id = ? ORDER BY id").all(docIdNum) as { id: number; variant_id: number }[]
  const m = new Map<number, number>()
  for (const r of rows) if (!m.has(r.variant_id)) m.set(r.variant_id, r.id)
  return m
}

const SETTING_RULES: Record<string, (v: string) => boolean> = {
  "credit.limit_mode": (v) => ["off", "warn", "block"].includes(v),
  "sales.max_discount_percent": (v) => /^\d+(\.\d+)?$/.test(v) && Number(v) <= 100,
  "stock.allow_negative": (v) => v === "on" || v === "off",
  "receipts.allow_overpayment": (v) => v === "on" || v === "off",
  "returns.window_days": (v) => /^\d+$/.test(v) && Number(v) <= 3650,
  "timezone_offset_minutes": (v) => /^-?\d+$/.test(v) && Math.abs(Number(v)) <= 840,
  "backup.secondary_dir": (v) => v.length <= 300,
  "than.sizes": (v) => jsonList(v, 200),
  "payment.methods": (v) => jsonList(v, 30) && JSON.parse(v).length > 0,
  "invoice.layout": (v) => v === "A4 invoice" || v === "Thermal receipt",
  "print.thermal_width": (v) => v === "58" || v === "80",
  "expiry.warning_days": (v) => /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365,
}
function jsonList(v: string, max: number): boolean {
  try {
    const a = JSON.parse(v)
    return Array.isArray(a) && a.length <= max && a.every((x) => typeof x === "string" && x.length > 0 && x.length <= 60)
  } catch {
    return false
  }
}

export function createCommands(ctx: Ctx): Required<Handlers> {
  const db = () => ctx.db()
  const actor = (): Actor => ctx.session.actor(db())

  const h: Required<Handlers> = {
    // ----- never needs a signed-in user: handled in the registration layer -----
    "app:info": () => { throw new Error("handled elsewhere") },
    "license:status": () => { throw new Error("handled elsewhere") },
    "license:activate": () => { throw new Error("handled elsewhere") },
    "health:get": () => { throw new Error("handled elsewhere") },

    "auth:status": () => ({ setupNeeded: ctx.session.needsSetup(db()), user: ctx.session.current(db()) }),
    "auth:setup": (p) => ctx.session.setup(db(), p),
    "auth:login": (p) => ctx.session.login(db(), p.username, p.password),
    "auth:logout": () => (ctx.session.logout(db()), null),
    "auth:changePassword": (p) => (ctx.session.changePassword(db(), p.current, p.next), null),

    "snapshot:get": () => (actor(), buildSnapshot(db())),
    "products:list": (p) => (actor(), { ...listProducts(db(), p), summary: inventorySummary(db()) }),
    "docs:list": (p) => (actor(), listDocs(db(), p)),
    "movements:list": (p) => (actor(), listMovements(db(), p)),
    "report:run": (p) => (requirePermission(actor(), "report.view"), runReport(db(), p)),
    "ledger:get": (p) => (actor(), ledgerView(db(), p.kind, idNumber(p.id))),
    "business:get": () => getBusiness(db()),
    "business:set": (b) => (requirePermission(actor(), "settings.manage"), setBusiness(db(), actor().userId, b)),
    "config:get": () => getConfig(db()),
    "config:setFlag": (p) => (requirePermission(actor(), "settings.manage"), setFlag(db(), actor().userId, p.flag, p.enabled)),

    "sale:create": (p) => {
      const a = actor()
      const d = db()
      const res = postSale(d, a, {
        partyId: idNumber(p.partyId),
        ts: stamp(d, p.date),
        lines: p.lines.map((l) => ({ variantId: idNumber(l.productId), qty: l.qty, rate: optPaisa(l.rate), discount: optPaisa(l.discount) })),
        extraDiscount: optPaisa(p.discount),
        payments: payments(d, p.payments),
        notes: p.notes,
        overrideCreditLimit: p.overrideCreditLimit,
      })
      return { id: res.invoiceNo, warnings: res.warnings }
    },
    "purchase:create": (p) => {
      const a = actor()
      const d = db()
      const lines = p.lines.map((l) => {
        const variantId = idNumber(l.productId)
        return { variantId, qty: l.qty, rate: paisa(l.rate, "Rate"), discount: optPaisa(l.discount), batchId: undefined as number | undefined, _l: l }
      })
      const res = tx(d, () => {
        for (const l of lines) l.batchId = batchFor(d, l.variantId, l._l)
        return postPurchase(d, a, {
          supplierId: idNumber(p.supplierId),
          supplierInvoiceNo: p.supplierInvoice || undefined,
          ts: stamp(d, p.date),
          lines: lines.map(({ _l, ...rest }) => rest),
          extraDiscount: optPaisa(p.discount),
          payments: payments(d, p.payments),
          notes: p.notes,
        })
      })
      return { id: res.purchaseNo }
    },
    "sale:void": (p) => (voidSale(db(), actor(), docId(db(), "sales", p.id), p.reason), null),
    "purchase:void": (p) => (voidPurchase(db(), actor(), docId(db(), "purchases", p.id), p.reason), null),

    "receipt:create": (p) => {
      const d = db()
      const r = recordReceipt(d, actor(), { partyId: idNumber(p.partyId), accountId: accountId(d, p.account), method: p.method, amount: paisa(p.amount), ts: stamp(d, p.date), notes: p.notes, receivedBy: p.receivedBy })
      return { id: r.docNo }
    },
    "supplierPayment:create": (p) => {
      const d = db()
      const r = recordSupplierPayment(d, actor(), { partyId: idNumber(p.partyId), accountId: accountId(d, p.account), method: p.method, amount: paisa(p.amount), ts: stamp(d, p.date), notes: p.notes })
      return { id: r.docNo }
    },
    "expense:create": (p) => {
      const d = db()
      const cat = d.prepare("SELECT id FROM expense_categories WHERE name = ?").get(p.category) as { id: number } | undefined
      if (!cat) throw new AppError("NOT_FOUND", "Expense category not found")
      recordExpense(d, actor(), { categoryId: cat.id, amount: paisa(p.amount), accountId: accountId(d, p.account), description: p.notes, ts: stamp(d, p.date) })
      return null
    },
    "transfer:create": (p) => {
      const d = db()
      postTransfer(d, actor(), { fromAccountId: accountId(d, p.from), toAccountId: accountId(d, p.to), amount: paisa(p.amount), note: p.notes, ts: stamp(d, p.date) })
      return null
    },
    "stock:adjust": (p) => {
      adjustStock(db(), actor(), { variantId: idNumber(p.productId), qtyDelta: p.quantity, reason: p.reason + (p.notes ? ` · ${p.notes}` : ""), type: p.damage ? "damage" : undefined })
      return null
    },
    "stock:count": (p) => ({ adjusted: postStockCount(db(), actor(), { lines: p.lines.map((l) => ({ variantId: idNumber(l.productId), countedQty: l.counted })), note: p.note }).adjusted }),
    "opening:party": (p) => (postOpeningPartyBalance(db(), actor(), { kind: p.kind, partyId: idNumber(p.id), amount: paisa(p.amount) }), null),
    "opening:account": (p) => (postOpeningAccountBalance(db(), actor(), { accountId: accountId(db(), p.account), amount: paisa(p.amount) }), null),
    "opening:stock": (p) => (postOpeningStock(db(), actor(), { variantId: idNumber(p.productId), qty: p.qty, unitCost: paisa(p.cost) }), null),

    "party:save": (p) => {
      const id = saveParty(db(), actor(), p.kind, {
        id: p.id ? idNumber(p.id) : undefined, name: p.name, city: p.city, phone: p.phone, whatsapp: p.whatsapp, area: p.area, address: p.address, notes: p.notes,
        creditLimit: p.limit === undefined ? undefined : paisa(p.limit), paymentTermsDays: p.terms, active: p.active, openingBalance: p.openingBalance === undefined ? undefined : paisa(p.openingBalance),
      })
      return { id: fmtId(p.kind === "customer" ? "PTY" : "SUP", id) }
    },
    "product:save": (p) => {
      const id = saveProduct(db(), actor(), {
        id: p.id ? idNumber(p.id) : undefined, company: p.company, article: p.article, category: p.category, subcategory: p.subcategory, color: p.color, design: p.design, size: p.size, unit: p.unit, barcode: p.barcode, sku: p.sku,
        purchasePrice: paisa(p.cost), salePrice: paisa(p.rate), wholesalePrice: p.wholesale == null ? null : paisa(p.wholesale), minStock: p.minStock, active: p.active, openingQty: p.openingQty, openingCost: paisa(p.cost),
      })
      return { id: fmtId("VAR", id) }
    },

    "product:colors": (p) => {
      const r = saveProductColors(db(), actor(), {
        company: p.company, article: p.article, category: p.category, subcategory: p.subcategory, design: p.design, size: p.size, unit: p.unit,
        purchasePrice: paisa(p.cost), salePrice: paisa(p.rate), wholesalePrice: p.wholesale == null ? null : paisa(p.wholesale), minStock: p.minStock, colors: p.colors,
      })
      return { created: r.created.map((id) => fmtId("VAR", id)), skipped: r.skipped }
    },
    "product:image": (p) => {
      if (!ctx.imagesDir) throw new AppError("INVALID_STATE", "Photos are not available")
      if (p.thumb && p.full) saveProductImage(db(), actor(), ctx.imagesDir, idNumber(p.id), p.thumb, p.full)
      else removeProductImage(db(), actor(), ctx.imagesDir, idNumber(p.id))
      return null
    },

    "return:sale": (p) => {
      const d = db()
      const saleId = docId(d, "sales", p.invoice)
      const map = lineMap(d, "sale", saleId)
      const lines = Object.entries(p.quantities).filter(([, q]) => q > 0).map(([pid, qty]) => {
        const lid = map.get(idNumber(pid))
        if (!lid) throw new AppError("NOT_FOUND", "That item is not on this invoice")
        return { saleLineId: lid, qty, damaged: !!p.damaged }
      })
      const r = postSaleReturn(d, actor(), { saleId, lines, settlement: p.settlement, accountId: p.account ? accountId(d, p.account) : undefined, refundAmount: optPaisa(p.refund), reason: p.reason })
      return { id: r.returnNo, total: r.total / 100 }
    },
    "return:purchase": (p) => {
      const d = db()
      const purchaseId = docId(d, "purchases", p.purchase)
      const map = lineMap(d, "purchase", purchaseId)
      const lines = Object.entries(p.quantities).filter(([, q]) => q > 0).map(([pid, qty]) => {
        const lid = map.get(idNumber(pid))
        if (!lid) throw new AppError("NOT_FOUND", "That item is not on this purchase")
        return { purchaseLineId: lid, qty }
      })
      const r = postPurchaseReturn(d, actor(), { purchaseId, lines, refundAmount: optPaisa(p.refund), accountId: p.account ? accountId(d, p.account) : undefined, reason: p.reason })
      return { id: r.returnNo, total: r.total / 100 }
    },
    "exchange:create": (p) => {
      const d = db()
      const saleId = docId(d, "sales", p.invoice)
      const map = lineMap(d, "sale", saleId)
      const lines = Object.entries(p.quantities).filter(([, q]) => q > 0).map(([pid, qty]) => {
        const lid = map.get(idNumber(pid))
        if (!lid) throw new AppError("NOT_FOUND", "That item is not on this invoice")
        return { saleLineId: lid, qty }
      })
      const r = postExchange(d, actor(), {
        ret: { saleId, lines },
        sale: { partyId: idNumber(p.partyId), lines: p.lines.map((l) => ({ variantId: idNumber(l.productId), qty: l.qty, rate: optPaisa(l.rate), discount: optPaisa(l.discount) })), payments: payments(d, p.payments) },
      })
      return { returnId: r.ret.returnNo, invoice: r.sale.invoiceNo }
    },
    "closing:create": (p) => {
      const d = db()
      const r = postCashClosing(d, actor(), { accountId: accountId(d, p.account), businessDate: p.date, counted: paisa(p.counted), notes: p.notes })
      return { variance: r.variance / 100 }
    },

    "master:add": (p) => (addMaster(db(), actor(), p.kind, p.name, p.parent), null),
    "account:add": (p) => (addAccount(db(), actor(), { name: p.name, type: p.type, opening: p.opening === undefined ? undefined : paisa(p.opening) }), null),
    "account:setActive": (p) => (setAccountActive(db(), actor(), p.id, p.active), null),
    "settings:set": (p) => {
      const a = actor()
      requirePermission(a, "settings.manage")
      if (!(SETTING_KEYS as readonly string[]).includes(p.key) || !SETTING_RULES[p.key]?.(p.value)) throw new AppError("VALIDATION", "That setting value is not allowed")
      tx(db(), () => {
        setSetting(db(), p.key, p.value)
        audit(db(), a.userId, "settings.change", "settings", p.key, { value: p.value.slice(0, 80) })
      })
      return null
    },
    "sequence:set": (p) => {
      const a = actor()
      requirePermission(a, "settings.manage")
      if (!/^[A-Za-z0-9-]{1,10}$/.test(p.prefix)) throw new AppError("VALIDATION", "Prefix may use letters, numbers and dashes (up to 10 characters)")
      const r = db().prepare("UPDATE document_sequences SET prefix = ? WHERE kind = ?").run(p.prefix, p.kind)
      if (r.changes === 0) throw new AppError("NOT_FOUND", "Unknown document type")
      audit(db(), a.userId, "settings.change", "settings", `sequence.${p.kind}`, { prefix: p.prefix })
      return null
    },

    "user:create": (p) => {
      const a = actor()
      requirePermission(a, "users.manage")
      const d = db()
      tx(d, () => {
        const role = d.prepare("SELECT id FROM roles WHERE name = ?").get(p.role) as { id: number } | undefined
        if (!role) throw new AppError("NOT_FOUND", "Role not found")
        if (!p.username.trim() || /\s/.test(p.username.trim())) throw new AppError("VALIDATION", "Username cannot be empty or contain spaces")
        if (d.prepare("SELECT 1 FROM users WHERE username = ?").get(p.username.trim())) throw new AppError("VALIDATION", "This username is already in use")
        const id = Number(d.prepare("INSERT INTO users(username, display_name, password_hash, role_id) VALUES (?,?,?,?)").run(p.username.trim(), p.name.trim() || p.username.trim(), hashPassword(p.password), role.id).lastInsertRowid)
        audit(d, a.userId, "user.create", "user", id, { username: p.username.trim(), role: p.role })
      })
      return null
    },
    "user:setActive": (p) => {
      const a = actor()
      requirePermission(a, "users.manage")
      const d = db()
      const id = idNumber(p.id)
      tx(d, () => {
        if (!p.active) {
          if (id === a.userId) throw new AppError("INVALID_STATE", "You cannot deactivate your own account")
          const owners = d.prepare("SELECT COUNT(*) c FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'Owner / Admin' AND u.active = 1 AND u.id <> ?").get(id) as { c: number }
          const target = d.prepare("SELECT r.name AS role FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(id) as { role: string } | undefined
          if (target?.role === "Owner / Admin" && owners.c === 0) throw new AppError("INVALID_STATE", "At least one active owner account is required")
        }
        d.prepare("UPDATE users SET active = ? WHERE id = ?").run(p.active ? 1 : 0, id)
        audit(d, a.userId, "user.update", "user", id, { active: p.active })
      })
      return null
    },
    "user:resetPassword": (p) => {
      const a = actor()
      requirePermission(a, "users.manage")
      const id = idNumber(p.id)
      const r = db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(p.password), id)
      if (r.changes === 0) throw new AppError("NOT_FOUND", "User not found")
      audit(db(), a.userId, "user.password_reset", "user", id)
      return null
    },
    "role:setPermission": (p) => {
      const a = actor()
      requirePermission(a, "users.manage")
      const d = db()
      if (p.role === "Owner / Admin") throw new AppError("INVALID_STATE", "The owner role always has every permission")
      if (!(ALL_PERMISSIONS as ReadonlySet<string>).has(p.permission)) throw new AppError("VALIDATION", "Unknown permission")
      const role = d.prepare("SELECT id FROM roles WHERE name = ?").get(p.role) as { id: number } | undefined
      if (!role) throw new AppError("NOT_FOUND", "Role not found")
      tx(d, () => {
        if (p.allowed) d.prepare("INSERT OR IGNORE INTO role_permissions(role_id, permission) VALUES (?,?)").run(role.id, p.permission as Permission)
        else d.prepare("DELETE FROM role_permissions WHERE role_id = ? AND permission = ?").run(role.id, p.permission)
        audit(d, a.userId, "role.permission", "role", p.role, { permission: p.permission, allowed: p.allowed })
      })
      return null
    },

    "backup:run": async () => {
      requirePermission(actor(), "settings.manage")
      return { name: (await ctx.backups().run("manual")).split(/[\\/]/).pop()! }
    },
    "backup:list": () => (actor(), ctx.backups().list()),
    "backup:restore": async (p) => {
      requirePermission(actor(), "backup.restore")
      audit(db(), actor().userId, "backup.restore", "backup", p.name)
      await ctx.restore(p.name)
      return null
    },
    "backup:chooseFolder": async () => {
      const a = actor()
      requirePermission(a, "settings.manage")
      const folder = await ctx.chooseFolder()
      if (folder) {
        setSetting(db(), "backup.secondary_dir", folder)
        audit(db(), a.userId, "settings.change", "settings", "backup.secondary_dir", { value: folder })
      }
      return { folder }
    },
  }
  void PERMISSIONS
  return h
}
