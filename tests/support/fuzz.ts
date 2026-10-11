import { AppError } from "../../src/core/errors"
import type { DB } from "../../src/main/db/connection"
import type { Actor } from "../../src/core/permissions"
import { postPurchase, voidPurchase } from "../../src/main/services/purchases"
import { postExchange, postPurchaseReturn, postSaleReturn } from "../../src/main/services/returns"
import { postSale, voidSale } from "../../src/main/services/sales"
import { adjustStock, postTransfer, recordExpense, recordReceipt, recordSupplierPayment } from "../../src/main/services/payments"
import { postCashClosing, postStockCount } from "../../src/main/services/closing"
import { createAccount, createCity, createCompany, createExpenseCategory, createItem, createParty, createSupplier, createVariant } from "../../src/main/services/masterData"

/** Small deterministic generator so a failing run can be replayed from its seed. */
export function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: <T>(xs: T[]): T => xs[Math.floor(next() * xs.length)]!,
    chance: (p: number) => next() < p,
  }
}
export type Rng = ReturnType<typeof rng>

export interface World {
  db: DB
  actor: Actor
  variants: number[]
  customers: number[]
  suppliers: number[]
  accounts: number[]
  expenseCategory: number
}

export function buildWorld(db: DB, actor: Actor, r: Rng, sizes = { variants: 12, customers: 8, suppliers: 4 }): World {
  const city = createCity(db, "Fuzzpur")
  const company = createCompany(db, actor, "Fuzz Co")
  const item = createItem(db, { companyId: company, name: "Article" })
  const variants: number[] = []
  for (let i = 0; i < sizes.variants; i++) {
    const cost = r.int(500, 5000) * 100 + r.int(0, 99)
    variants.push(createVariant(db, { itemId: item, color: `C${i}`, sizeLabel: `${r.int(10, 60)} m`, purchasePrice: cost, salePrice: Math.round(cost * 1.3) }))
  }
  const customers = Array.from({ length: sizes.customers }, (_, i) => createParty(db, { name: `Customer ${i}`, cityId: city, creditLimit: 0 }))
  const suppliers = Array.from({ length: sizes.suppliers }, (_, i) => createSupplier(db, { name: `Supplier ${i}` }))
  const accounts = [createAccount(db, "Fuzz Cash", "cash"), createAccount(db, "Fuzz Bank", "bank")]
  return { db, actor, variants, customers, suppliers, accounts, expenseCategory: createExpenseCategory(db, "Fuzz Misc") }
}

export type Op = "sale" | "purchase" | "receipt" | "supplierPay" | "expense" | "transfer" | "saleReturn" | "purchaseReturn" | "voidSale" | "voidPurchase" | "adjust" | "count" | "exchange" | "closing"
export const OPS: Op[] = ["sale", "purchase", "receipt", "supplierPay", "expense", "transfer", "saleReturn", "purchaseReturn", "voidSale", "voidPurchase", "adjust", "count", "exchange", "closing"]
// Purchases and sales dominate, like a real shop.
const WEIGHTS: Record<Op, number> = { sale: 30, purchase: 14, receipt: 9, supplierPay: 5, expense: 4, transfer: 2, saleReturn: 6, purchaseReturn: 3, voidSale: 3, voidPurchase: 2, adjust: 3, count: 2, exchange: 3, closing: 1 }

export type Tally = Record<string, { ok: number; rejected: number }>

const rows = <T>(db: DB, sql: string, ...a: unknown[]) => db.prepare(sql).all(...a) as T[]
const money = (r: Rng, lo: number, hi: number) => r.int(lo, hi) * 100 + r.int(0, 99)

function splitPayment(r: Rng, w: World, total: number) {
  if (total <= 0 || r.chance(0.25)) return []
  const paid = r.chance(0.5) ? total : r.int(1, total)
  if (r.chance(0.3) && paid > 1) {
    const a = r.int(1, paid - 1)
    return [
      { accountId: w.accounts[0]!, method: "Cash", amount: a },
      { accountId: w.accounts[1]!, method: "Bank", amount: paid - a },
    ]
  }
  return [{ accountId: r.pick(w.accounts), method: "Cash", amount: paid }]
}

function saleInput(w: World, r: Rng) {
  const n = r.int(1, 4)
  const chosen = new Set<number>()
  const lines = []
  for (let i = 0; i < n; i++) {
    const v = r.pick(w.variants)
    if (chosen.has(v)) continue
    chosen.add(v)
    const price = (w.db.prepare("SELECT sale_price p FROM variants WHERE id=?").get(v) as { p: number }).p
    const qty = r.int(1, 12)
    const gross = price * qty
    lines.push({ variantId: v, qty, discount: r.chance(0.25) ? r.int(0, Math.floor(gross / 10)) : 0, rate: r.chance(0.15) ? Math.max(1, price + r.int(-200, 200)) : undefined })
  }
  const subtotal = lines.reduce((s, l) => s + (l.rate ?? 0) * 0, 0) // placeholder to keep types simple
  void subtotal
  const gross = lines.reduce((s, l) => s + (l.rate ?? (w.db.prepare("SELECT sale_price p FROM variants WHERE id=?").get(l.variantId) as { p: number }).p) * l.qty - l.discount, 0)
  const extraDiscount = r.chance(0.2) ? r.int(0, Math.floor(gross / 20)) : 0
  const total = Math.max(0, gross - extraDiscount)
  return { partyId: r.pick(w.customers), lines, extraDiscount, payments: splitPayment(r, w, total) }
}

export function step(w: World, r: Rng, tally: Tally, only?: Op): Op {
  const db = w.db
  const total = Object.values(WEIGHTS).reduce((s, x) => s + x, 0)
  let pick = r.int(1, total)
  let op: Op = "sale"
  for (const k of OPS) {
    pick -= WEIGHTS[k]
    if (pick <= 0) {
      op = k
      break
    }
  }
  if (only) op = only
  const t = (tally[op] ??= { ok: 0, rejected: 0 })
  try {
    switch (op) {
      case "sale":
        postSale(db, w.actor, saleInput(w, r))
        break
      case "purchase": {
        const n = r.int(1, 4)
        const lines = Array.from(new Set(Array.from({ length: n }, () => r.pick(w.variants)))).map((v) => ({ variantId: v, qty: r.int(1, 40), rate: money(r, 500, 5000), discount: r.chance(0.2) ? r.int(0, 5000) : 0 }))
        const gross = lines.reduce((s, l) => s + l.rate * l.qty - l.discount, 0)
        const extraDiscount = r.chance(0.3) ? r.int(1, Math.max(1, Math.min(gross, 100_000))) : 0
        postPurchase(db, w.actor, { supplierId: r.pick(w.suppliers), lines, extraDiscount, payments: splitPayment(r, w, gross - extraDiscount) })
        break
      }
      case "receipt": {
        const owing = rows<{ id: number; b: number }>(db, "SELECT party_id id, SUM(debit)-SUM(credit) b FROM ledger_entries WHERE party_kind='customer' GROUP BY party_id HAVING b > 0")
        if (!owing.length) throw new AppError("VALIDATION", "nobody owes")
        const p = r.pick(owing)
        recordReceipt(db, w.actor, { partyId: p.id, accountId: r.pick(w.accounts), method: "Cash", amount: r.chance(0.4) ? p.b : r.int(1, p.b) })
        break
      }
      case "supplierPay": {
        const owed = rows<{ id: number; b: number }>(db, "SELECT party_id id, SUM(credit)-SUM(debit) b FROM ledger_entries WHERE party_kind='supplier' GROUP BY party_id HAVING b > 0")
        if (!owed.length) throw new AppError("VALIDATION", "we owe nobody")
        const p = r.pick(owed)
        recordSupplierPayment(db, w.actor, { partyId: p.id, accountId: r.pick(w.accounts), method: "Cash", amount: r.chance(0.4) ? p.b : r.int(1, p.b) })
        break
      }
      case "expense":
        recordExpense(db, w.actor, { categoryId: w.expenseCategory, amount: money(r, 1, 800), accountId: r.pick(w.accounts) })
        break
      case "transfer":
        postTransfer(db, w.actor, { fromAccountId: w.accounts[0]!, toAccountId: w.accounts[1]!, amount: money(r, 1, 3000) })
        break
      case "saleReturn": {
        const lines = rows<{ id: number; sale_id: number; qty: number }>(db, "SELECT l.id, l.sale_id, l.qty FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.status='completed' ORDER BY RANDOM() LIMIT 1")
        const l = lines[0]
        if (!l) throw new AppError("VALIDATION", "no sale")
        const cash = r.chance(0.4)
        postSaleReturn(db, w.actor, { saleId: l.sale_id, lines: [{ saleLineId: l.id, qty: r.int(1, l.qty), damaged: r.chance(0.25) }], settlement: cash ? "cash" : "balance", accountId: w.accounts[0], refundAmount: cash ? 1 : undefined })
        break
      }
      case "purchaseReturn": {
        const l = rows<{ id: number; purchase_id: number; qty: number }>(db, "SELECT l.id, l.purchase_id, l.qty FROM purchase_lines l JOIN purchases s ON s.id=l.purchase_id WHERE s.status='completed' ORDER BY RANDOM() LIMIT 1")[0]
        if (!l) throw new AppError("VALIDATION", "no purchase")
        postPurchaseReturn(db, w.actor, { purchaseId: l.purchase_id, lines: [{ purchaseLineId: l.id, qty: r.int(1, l.qty) }], refundAmount: r.chance(0.3) ? 1 : undefined, accountId: w.accounts[0] })
        break
      }
      case "voidSale": {
        const s = rows<{ id: number }>(db, "SELECT id FROM sales WHERE status='completed' ORDER BY RANDOM() LIMIT 1")[0]
        if (!s) throw new AppError("VALIDATION", "no sale")
        voidSale(db, w.actor, s.id, "fuzz")
        break
      }
      case "voidPurchase": {
        const s = rows<{ id: number }>(db, "SELECT id FROM purchases WHERE status='completed' ORDER BY RANDOM() LIMIT 1")[0]
        if (!s) throw new AppError("VALIDATION", "no purchase")
        voidPurchase(db, w.actor, s.id, "fuzz")
        break
      }
      case "adjust": {
        const v = r.pick(w.variants)
        adjustStock(db, w.actor, { variantId: v, qtyDelta: r.chance(0.5) ? r.int(1, 5) : -r.int(1, 5), reason: "fuzz", type: r.chance(0.5) ? "damage" : "adjustment_out" })
        break
      }
      case "count": {
        const lines = Array.from(new Set(Array.from({ length: r.int(1, 3) }, () => r.pick(w.variants)))).map((v) => ({ variantId: v, countedQty: r.int(0, 60) }))
        postStockCount(db, w.actor, { lines })
        break
      }
      case "exchange": {
        const l = rows<{ id: number; sale_id: number; qty: number; party_id: number }>(db, "SELECT l.id, l.sale_id, l.qty, s.party_id FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.status='completed' ORDER BY RANDOM() LIMIT 1")[0]
        if (!l) throw new AppError("VALIDATION", "no sale")
        postExchange(db, w.actor, { ret: { saleId: l.sale_id, lines: [{ saleLineId: l.id, qty: r.int(1, l.qty) }] }, sale: { partyId: l.party_id, lines: [{ variantId: r.pick(w.variants), qty: r.int(1, 6) }], payments: [] } })
        break
      }
      case "closing": {
        const day = `2099-${String(r.int(1, 12)).padStart(2, "0")}-${String(r.int(1, 28)).padStart(2, "0")}`
        postCashClosing(db, w.actor, { accountId: r.pick(w.accounts), businessDate: day, counted: money(r, 0, 100_000) })
        break
      }
    }
    t.ok++
  } catch (e) {
    if (!(e instanceof AppError)) throw new Error(`${op} crashed with a non-business error: ${(e as Error).stack}`)
    t.rejected++
  }
  return op
}
