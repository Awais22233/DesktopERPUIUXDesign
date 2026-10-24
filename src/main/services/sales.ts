import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { lineAmount } from "@core/money"
import { can, requirePermission, type Actor } from "@core/permissions"
import { audit, getSetting, nextDocNo, tx } from "../db/util"
import { postMovement } from "./stock"
import { addAccountEntry, addLedgerEntry } from "./posting"
import { isFlagEnabled, resolveTimestamp } from "./policy"
import { customerBalance } from "./queries"
import { perThan } from "./meters"

export interface SaleLineInput {
  variantId: number
  qty: number
  /** Minor units per unit. Omit to use the default price. A different value needs price-override permission. */
  rate?: number
  /** Minor units, whole line. */
  discount?: number
}
export interface PaymentInput {
  accountId: number
  method: string
  amount: number
}
export interface SaleInput {
  partyId: number
  ts?: string
  lines: SaleLineInput[]
  /** Extra invoice-level discount in minor units. */
  extraDiscount?: number
  payments: PaymentInput[]
  notes?: string
  overrideCreditLimit?: boolean
  /** The number from the shop's own bill book. Empty means: use the next automatic number. */
  invoiceNo?: string
}
export interface SaleResult {
  saleId: number
  invoiceNo: string
  subtotal: number
  discount: number
  total: number
  paid: number
  outstanding: number
  warnings: string[]
}

/** First-expiry-first-out: which batches a sale draws from. Any quantity beyond known batches has no batch. */
/** A hand-written bill number: any short visible text, e.g. "1042", "A-17", "17/B". */
export function cleanInvoiceNo(raw: string | undefined): string | null {
  const s = (raw ?? "").trim().replace(/\s+/g, " ")
  if (s === "") return null
  if (s.length > 30) throw new AppError("VALIDATION", "Bill number can be at most 30 characters")
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(s)) throw new AppError("VALIDATION", "Bill number has an invalid character")
  return s
}

export function invoiceNoTaken(db: DB, no: string, exceptSaleId = 0): boolean {
  return db.prepare("SELECT 1 FROM sales WHERE invoice_no = ? COLLATE NOCASE AND id != ?").get(no, exceptSaleId) !== undefined
}

/** The automatic number, skipping any that a typed number has already used. */
function freeAutoNo(db: DB): string {
  for (let i = 0; i < 100000; i++) {
    const no = nextDocNo(db, "sale")
    if (!invoiceNoTaken(db, no)) return no
  }
  throw new AppError("INTERNAL", "No free invoice number")
}

/** Suggestion for the bill-number box: the last bill number plus one (keeps prefix and zero padding). */
export function suggestInvoiceNo(db: DB): string {
  const last = db.prepare("SELECT invoice_no FROM sales ORDER BY id DESC LIMIT 1").get() as { invoice_no: string } | undefined
  const m = last ? /^(.*?)(\d+)$/.exec(last.invoice_no) : null
  if (m) {
    let n = BigInt(m[2])
    for (let i = 0; i < 1000; i++) {
      n += 1n
      const no = m[1] + String(n).padStart(m[2].length, "0")
      if (!invoiceNoTaken(db, no)) return no
    }
  }
  const row = db.prepare("SELECT prefix, next_number, padding FROM document_sequences WHERE kind = 'sale'").get() as { prefix: string; next_number: number; padding: number }
  let n = row.next_number
  for (let i = 0; i < 100000; i++, n++) {
    const no = row.prefix + String(n).padStart(row.padding, "0")
    if (!invoiceNoTaken(db, no)) return no
  }
  return ""
}

export function renumberSale(db: DB, actor: Actor, saleId: number, raw: string): string {
  requirePermission(actor, "sale.void")
  const no = cleanInvoiceNo(raw)
  if (!no) throw new AppError("VALIDATION", "Type the bill number")
  return tx(db, () => {
    const sale = db.prepare("SELECT invoice_no FROM sales WHERE id = ?").get(saleId) as { invoice_no: string } | undefined
    if (!sale) throw new AppError("NOT_FOUND", "Bill not found")
    if (sale.invoice_no === no) return no
    if (invoiceNoTaken(db, no, saleId)) throw new AppError("VALIDATION", `Bill number ${no} is already used`)
    db.prepare("UPDATE sales SET invoice_no = ? WHERE id = ?").run(no, saleId)
    // statements and cash books quote the number in their description
    for (const table of ["ledger_entries", "account_entries"]) {
      db.prepare(`UPDATE ${table} SET description = REPLACE(description, ?, ?) WHERE source_type = 'sale' AND source_id = ?`).run(sale.invoice_no, no, saleId)
    }
    audit(db, actor.userId, "sale.renumber", "sale", saleId, { from: sale.invoice_no, to: no })
    return no
  })
}

export function allocateBatches(db: DB, variantId: number, qty: number): { batchId: number | null; qty: number }[] {
  const batches = db
    .prepare(
      `SELECT b.id, COALESCE(SUM(m.qty_delta),0) AS remaining FROM batches b LEFT JOIN stock_movements m ON m.batch_id = b.id
       WHERE b.variant_id = ? GROUP BY b.id HAVING remaining > 0 ORDER BY (b.expiry_date IS NULL), b.expiry_date, b.id`,
    )
    .all(variantId) as { id: number; remaining: number }[]
  const out: { batchId: number | null; qty: number }[] = []
  let left = qty
  for (const b of batches) {
    if (left <= 0) break
    const take = Math.min(left, b.remaining)
    out.push({ batchId: b.id, qty: take })
    left -= take
  }
  if (left > 0) out.push({ batchId: null, qty: left })
  return out
}

function defaultRate(db: DB, v: { sale_price: number; wholesale_price: number | null }): number {
  return isFlagEnabled(db, "wholesalePrice") && v.wholesale_price !== null ? v.wholesale_price : v.sale_price
}

/**
 * A completed sale is ONE database transaction: invoice, lines, stock, customer ledger,
 * payment accounts and audit are all written or none are.
 */
export function postSale(db: DB, actor: Actor, input: SaleInput): SaleResult {
  requirePermission(actor, "sale.create")
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Add at least one item")

  return tx(db, () => {
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const warnings: string[] = []

    const party = db.prepare("SELECT id, name, credit_limit, status, is_walk_in FROM parties WHERE id = ?").get(input.partyId) as
      | { id: number; name: string; credit_limit: number; status: string; is_walk_in: number }
      | undefined
    if (!party) throw new AppError("NOT_FOUND", "Party not found")
    if (party.status !== "active") throw new AppError("INVALID_STATE", "This party is inactive")

    // ----- price lines -----
    const lines = input.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("VALIDATION", "Quantity must be a whole number greater than zero")
      const v = db
        .prepare("SELECT id, sale_price, wholesale_price, size_label, length_tenths, active FROM variants WHERE id = ?")
        .get(l.variantId) as { id: number; sale_price: number; wholesale_price: number | null; size_label: string | null; length_tenths: number | null; active: number } | undefined
      if (!v) throw new AppError("NOT_FOUND", `Variant ${l.variantId} not found`)
      if (!v.active) throw new AppError("INVALID_STATE", `Variant ${l.variantId} is inactive`)
      const standard = defaultRate(db, v)
      // a variant with a length is sold by the meter: the rate typed is per meter, the than costs length x rate
      const typed = l.rate ?? standard
      if (typed <= 0) throw new AppError("VALIDATION", "Enter the rate for every item")
      // with no fixed price on the product, the rate typed on the bill is the price, not an override
      if (standard > 0 && typed !== standard) requirePermission(actor, "sale.price_override")
      const rate = v.length_tenths === null ? typed : perThan(typed, v.length_tenths)
      const rateM = v.length_tenths === null ? null : typed
      const gross = lineAmount(rate, l.qty)
      const discount = l.discount ?? 0
      if (!Number.isSafeInteger(discount) || discount < 0 || discount > gross) throw new AppError("VALIDATION", "Invalid line discount")
      return { variantId: v.id, qty: l.qty, rate, rateM, len: v.length_tenths, discount, gross, lineTotal: gross - discount, sizeLabel: v.size_label }
    })

    const subtotal = lines.reduce((s, l) => s + l.gross, 0)
    const lineDiscounts = lines.reduce((s, l) => s + l.discount, 0)
    const extra = input.extraDiscount ?? 0
    if (!Number.isSafeInteger(extra) || extra < 0 || lineDiscounts + extra > subtotal) throw new AppError("VALIDATION", "Invalid discount")
    const discount = lineDiscounts + extra
    const total = subtotal - discount

    const maxPct = Number(getSetting(db, "sales.max_discount_percent", "100"))
    if (subtotal > 0 && (discount * 100) / subtotal > maxPct) requirePermission(actor, "sale.discount_override")

    // ----- payments -----
    const payments = input.payments.map((p) => {
      if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new AppError("VALIDATION", "Payment amount must be greater than zero")
      const acc = db.prepare("SELECT id, active FROM accounts WHERE id = ?").get(p.accountId) as { id: number; active: number } | undefined
      if (!acc || !acc.active) throw new AppError("NOT_FOUND", "Payment account not found or inactive")
      return p
    })
    const paid = payments.reduce((s, p) => s + p.amount, 0)
    if (paid > total) throw new AppError("VALIDATION", "Payment cannot exceed the invoice total")
    const credit = total - paid
    if (party.is_walk_in && credit > 0) throw new AppError("VALIDATION", "Walk-in customers must pay in full")

    // ----- credit limit -----
    if (credit > 0 && party.credit_limit > 0) {
      const mode = getSetting(db, "credit.limit_mode", "off")
      const after = customerBalance(db, party.id) + credit
      if (mode !== "off" && after > party.credit_limit) {
        const text = `${party.name} would owe ${after / 100}, above the credit limit of ${party.credit_limit / 100}`
        if (mode === "block") {
          if (!(input.overrideCreditLimit && can(actor, "sale.credit_limit_override"))) throw new AppError("CREDIT_LIMIT", text, { after, limit: party.credit_limit })
          warnings.push(`Credit limit overridden: ${text}`)
        } else warnings.push(text)
      }
    }

    // ----- write -----
    const typedNo = cleanInvoiceNo(input.invoiceNo)
    if (typedNo && invoiceNoTaken(db, typedNo)) throw new AppError("VALIDATION", `Bill number ${typedNo} is already used. Check your bill book.`)
    const invoiceNo = typedNo ?? freeAutoNo(db)
    const saleId = Number(
      db
        .prepare(
          `INSERT INTO sales(invoice_no, ts, party_id, subtotal, discount, total, paid, notes, user_id)
           VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .run(invoiceNo, ts, party.id, subtotal, discount, total, paid, input.notes ?? null, actor.userId).lastInsertRowid,
    )

    for (const l of lines) {
      let costTotal = 0
      for (const chunk of allocateBatches(db, l.variantId, l.qty)) {
        costTotal += postMovement(db, {
          variantId: l.variantId,
          qtyDelta: -chunk.qty,
          type: "sale",
          sourceType: "sale",
          sourceId: saleId,
          batchId: chunk.batchId,
          userId: actor.userId,
          ts,
          allowNegative: getSetting(db, "stock.allow_negative", "off") === "on",
        }).value
      }
      db.prepare(
        `INSERT INTO sale_lines(sale_id, variant_id, qty, rate, discount, line_total, unit_cost, cost_total, size_label, length_tenths, rate_m)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(saleId, l.variantId, l.qty, l.rate, l.discount, l.lineTotal, Math.round(costTotal / l.qty), costTotal, l.sizeLabel, l.len, l.rateM)
    }

    // Sale and payment are separate facts: the sale is a debit, each payment a credit.
    addLedgerEntry(db, { ts, partyKind: "customer", partyId: party.id, debit: total, kind: "sale", sourceType: "sale", sourceId: saleId, description: `Sale ${invoiceNo}`, userId: actor.userId })
    for (const p of payments) {
      db.prepare("INSERT INTO sale_payments(sale_id, account_id, method, amount) VALUES (?,?,?,?)").run(saleId, p.accountId, p.method, p.amount)
      addAccountEntry(db, { ts, accountId: p.accountId, amount: p.amount, kind: "sale_receipt", sourceType: "sale", sourceId: saleId, description: `Sale ${invoiceNo}`, userId: actor.userId })
    }
    if (paid > 0) {
      addLedgerEntry(db, { ts, partyKind: "customer", partyId: party.id, credit: paid, kind: "receipt", sourceType: "sale", sourceId: saleId, description: `Payment with ${invoiceNo}`, userId: actor.userId })
    }

    audit(db, actor.userId, "sale.create", "sale", saleId, { invoiceNo, total, paid, partyId: party.id })
    return { saleId, invoiceNo, subtotal, discount, total, paid, outstanding: credit, warnings }
  })
}

/** Cancels a sale without deleting anything: every effect is reversed by new entries. */
export function voidSale(db: DB, actor: Actor, saleId: number, reason: string): void {
  requirePermission(actor, "sale.void")
  if (!reason.trim()) throw new AppError("VALIDATION", "A reason is required to void a sale")
  tx(db, () => {
    const sale = db.prepare("SELECT id, invoice_no, party_id, total, paid, status FROM sales WHERE id = ?").get(saleId) as
      | { id: number; invoice_no: string; party_id: number; total: number; paid: number; status: string }
      | undefined
    if (!sale) throw new AppError("NOT_FOUND", "Sale not found")
    if (sale.status !== "completed") throw new AppError("INVALID_STATE", "This sale is already void")
    // Reversing a sale that was partly returned would bring the returned goods back a second time.
    if (db.prepare("SELECT 1 FROM sale_returns WHERE sale_id = ?").get(saleId)) {
      throw new AppError("INVALID_STATE", "This sale has a return against it and cannot be cancelled. Record a further return instead.")
    }
    const ts = new Date().toISOString()

    // Reverse exactly what was taken out (same quantities, batches and costs).
    const moved = db.prepare("SELECT variant_id, batch_id, -qty_delta AS qty, unit_cost, -value AS value FROM stock_movements WHERE source_type = 'sale' AND source_id = ? AND type = 'sale'").all(saleId) as { variant_id: number; batch_id: number | null; qty: number; unit_cost: number; value: number }[]
    for (const m of moved) {
      postMovement(db, { variantId: m.variant_id, qtyDelta: m.qty, unitCost: m.unit_cost, value: m.value, batchId: m.batch_id, type: "sale_void", sourceType: "sale", sourceId: saleId, note: reason, userId: actor.userId, ts })
    }
    addLedgerEntry(db, { ts, partyKind: "customer", partyId: sale.party_id, credit: sale.total, kind: "sale_void", sourceType: "sale", sourceId: saleId, description: `Void ${sale.invoice_no}`, userId: actor.userId })
    if (sale.paid > 0) {
      addLedgerEntry(db, { ts, partyKind: "customer", partyId: sale.party_id, debit: sale.paid, kind: "sale_void", sourceType: "sale", sourceId: saleId, description: `Payment reversed for ${sale.invoice_no}`, userId: actor.userId })
    }
    const pays = db.prepare("SELECT account_id, amount FROM sale_payments WHERE sale_id = ?").all(saleId) as { account_id: number; amount: number }[]
    for (const p of pays) {
      addAccountEntry(db, { ts, accountId: p.account_id, amount: -p.amount, kind: "void_reversal", sourceType: "sale", sourceId: saleId, description: `Void ${sale.invoice_no}`, userId: actor.userId })
    }
    db.prepare("UPDATE sales SET status='void', void_reason=?, voided_at=?, voided_by=? WHERE id=?").run(reason, ts, actor.userId, saleId)
    audit(db, actor.userId, "sale.void", "sale", saleId, { invoiceNo: sale.invoice_no, reason })
  })
}
