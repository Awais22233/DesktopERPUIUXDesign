import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { lineAmount } from "@core/money"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, nextDocNo, tx } from "../db/util"
import { cleanInvoiceNo } from "./sales"
import { postMovement } from "./stock"
import { addAccountEntry, addLedgerEntry } from "./posting"
import { resolveTimestamp } from "./policy"
import type { PaymentInput } from "./sales"
import { perThan, toTenths, variantForLength } from "./meters"

export interface PurchaseLineInput {
  variantId: number
  qty: number
  /** Price of one than. For a variant with a length (or when lengthMeters is given) it is the price of one METER. */
  rate: number
  discount?: number
  batchId?: number
  /** Cloth: the length of the than in meters (one decimal). The product's variant with that length is used or created. */
  lengthMeters?: number
}
export interface PurchaseInput {
  supplierId: number
  supplierInvoiceNo?: string
  ts?: string
  lines: PurchaseLineInput[]
  extraDiscount?: number
  payments: PaymentInput[]
  notes?: string
}
export interface PurchaseResult {
  purchaseId: number
  purchaseNo: string
  total: number
  paid: number
  payable: number
}

export function purchaseNoTaken(db: DB, no: string, exceptId = 0): boolean {
  return db.prepare("SELECT 1 FROM purchases WHERE purchase_no = ? COLLATE NOCASE AND id != ?").get(no, exceptId) !== undefined
}

export function renumberPurchase(db: DB, actor: Actor, purchaseId: number, raw: string): string {
  requirePermission(actor, "purchase.void")
  const no = cleanInvoiceNo(raw)
  if (!no) throw new AppError("VALIDATION", "Type the bill number")
  return tx(db, () => {
    const p = db.prepare("SELECT purchase_no FROM purchases WHERE id = ?").get(purchaseId) as { purchase_no: string } | undefined
    if (!p) throw new AppError("NOT_FOUND", "Purchase not found")
    if (p.purchase_no === no) return no
    if (purchaseNoTaken(db, no, purchaseId)) throw new AppError("VALIDATION", `Bill number ${no} is already used`)
    db.prepare("UPDATE purchases SET purchase_no = ? WHERE id = ?").run(no, purchaseId)
    for (const table of ["ledger_entries", "account_entries"]) {
      db.prepare(`UPDATE ${table} SET description = REPLACE(description, ?, ?) WHERE source_type = 'purchase' AND source_id = ?`).run(p.purchase_no, no, purchaseId)
    }
    audit(db, actor.userId, "purchase.renumber", "purchase", purchaseId, { from: p.purchase_no, to: no })
    return no
  })
}

export function postPurchase(db: DB, actor: Actor, input: PurchaseInput): PurchaseResult {
  requirePermission(actor, "purchase.create")
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Add at least one item")

  return tx(db, () => {
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const supplier = db.prepare("SELECT id, status FROM suppliers WHERE id = ?").get(input.supplierId) as { id: number; status: string } | undefined
    if (!supplier) throw new AppError("NOT_FOUND", "Supplier not found")
    if (supplier.status !== "active") throw new AppError("INVALID_STATE", "This supplier is inactive")

    const lines = input.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("VALIDATION", "Quantity must be a whole number greater than zero")
      if (!Number.isSafeInteger(l.rate) || l.rate < 0) throw new AppError("VALIDATION", "Invalid rate")
      let variantId = l.variantId
      if (l.lengthMeters !== undefined) variantId = variantForLength(db, variantId, toTenths(l.lengthMeters))
      const len = (db.prepare("SELECT length_tenths FROM variants WHERE id = ?").get(variantId) as { length_tenths: number | null } | undefined)?.length_tenths ?? null
      // with a length the rate typed is per meter; the amount is than x length x rate
      const rateM = len === null ? null : l.rate
      const rate = len === null ? l.rate : perThan(l.rate, len)
      const gross = lineAmount(rate, l.qty)
      const discount = l.discount ?? 0
      if (!Number.isSafeInteger(discount) || discount < 0 || discount > gross) throw new AppError("VALIDATION", "Invalid line discount")
      return { ...l, variantId, rate, rateM, len, discount, gross, lineTotal: gross - discount }
    })
    const subtotal = lines.reduce((s, l) => s + l.gross, 0)
    const lineDiscounts = lines.reduce((s, l) => s + l.discount, 0)
    const extra = input.extraDiscount ?? 0
    if (!Number.isSafeInteger(extra) || extra < 0 || lineDiscounts + extra > subtotal) throw new AppError("VALIDATION", "Invalid discount")
    const discount = lineDiscounts + extra
    const total = subtotal - discount

    const payments = input.payments.map((p) => {
      if (!Number.isSafeInteger(p.amount) || p.amount <= 0) throw new AppError("VALIDATION", "Payment amount must be greater than zero")
      const acc = db.prepare("SELECT id, active FROM accounts WHERE id = ?").get(p.accountId) as { id: number; active: number } | undefined
      if (!acc || !acc.active) throw new AppError("NOT_FOUND", "Payment account not found or inactive")
      return p
    })
    const paid = payments.reduce((s, p) => s + p.amount, 0)
    if (paid > total) throw new AppError("VALIDATION", "Payment cannot exceed the purchase total")

    let purchaseNo = nextDocNo(db, "purchase")
    // a number the owner typed over a bill earlier must never be handed out again
    while (purchaseNoTaken(db, purchaseNo)) purchaseNo = nextDocNo(db, "purchase")
    const purchaseId = Number(
      db
        .prepare(
          `INSERT INTO purchases(purchase_no, supplier_invoice_no, ts, supplier_id, subtotal, discount, total, paid, notes, user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(purchaseNo, input.supplierInvoiceNo ?? null, ts, supplier.id, subtotal, discount, total, paid, input.notes ?? null, actor.userId).lastInsertRowid,
    )

    // The invoice-level discount is shared across lines (exactly, to the paisa) so stock is valued at what was really paid.
    const lineSum = lines.reduce((s, l) => s + l.lineTotal, 0)
    let cumLine = 0
    let cumShare = 0
    for (const l of lines) {
      cumLine += l.lineTotal
      const cum = lineSum > 0 ? Math.round((extra * cumLine) / lineSum) : 0
      const share = cum - cumShare
      cumShare = cum
      const value = Math.max(0, l.lineTotal - share)
      db.prepare(
        `INSERT INTO purchase_lines(purchase_id, variant_id, qty, rate, discount, line_total, batch_id, length_tenths, rate_m) VALUES (?,?,?,?,?,?,?,?,?)`,
      ).run(purchaseId, l.variantId, l.qty, l.rate, l.discount, l.lineTotal, l.batchId ?? null, l.len, l.rateM)
      // the next purchase of this product starts from the latest supplier price (the average cost is kept separately)
      db.prepare("UPDATE variants SET purchase_price = ? WHERE id = ?").run(l.rateM ?? l.rate, l.variantId)
      postMovement(db, {
        variantId: l.variantId,
        qtyDelta: l.qty,
        unitCost: Math.round(value / l.qty),
        value,
        type: "purchase",
        sourceType: "purchase",
        sourceId: purchaseId,
        batchId: l.batchId ?? null,
        userId: actor.userId,
        ts,
      })
    }

    addLedgerEntry(db, { ts, partyKind: "supplier", partyId: supplier.id, credit: total, kind: "purchase", sourceType: "purchase", sourceId: purchaseId, description: `Purchase ${purchaseNo}`, userId: actor.userId })
    for (const p of payments) {
      db.prepare("INSERT INTO purchase_payments(purchase_id, account_id, method, amount) VALUES (?,?,?,?)").run(purchaseId, p.accountId, p.method, p.amount)
      addAccountEntry(db, { ts, accountId: p.accountId, amount: -p.amount, kind: "purchase_payment", sourceType: "purchase", sourceId: purchaseId, description: `Purchase ${purchaseNo}`, userId: actor.userId })
    }
    if (paid > 0) {
      addLedgerEntry(db, { ts, partyKind: "supplier", partyId: supplier.id, debit: paid, kind: "payment", sourceType: "purchase", sourceId: purchaseId, description: `Payment with ${purchaseNo}`, userId: actor.userId })
    }

    audit(db, actor.userId, "purchase.create", "purchase", purchaseId, { purchaseNo, total, paid, supplierId: supplier.id })
    return { purchaseId, purchaseNo, total, paid, payable: total - paid }
  })
}

export function voidPurchase(db: DB, actor: Actor, purchaseId: number, reason: string): void {
  requirePermission(actor, "purchase.void")
  if (!reason.trim()) throw new AppError("VALIDATION", "A reason is required to void a purchase")
  tx(db, () => {
    const p = db.prepare("SELECT id, purchase_no, supplier_id, total, paid, status FROM purchases WHERE id = ?").get(purchaseId) as
      | { id: number; purchase_no: string; supplier_id: number; total: number; paid: number; status: string }
      | undefined
    if (!p) throw new AppError("NOT_FOUND", "Purchase not found")
    if (p.status !== "completed") throw new AppError("INVALID_STATE", "This purchase is already void")
    if (db.prepare("SELECT 1 FROM purchase_returns WHERE purchase_id = ?").get(purchaseId)) {
      throw new AppError("INVALID_STATE", "This purchase has a return against it and cannot be cancelled.")
    }
    const ts = new Date().toISOString()

    const lines = db.prepare("SELECT variant_id, qty, batch_id FROM purchase_lines WHERE purchase_id = ?").all(purchaseId) as { variant_id: number; qty: number; batch_id: number | null }[]
    for (const l of lines) {
      // Fails with INSUFFICIENT_STOCK if the goods were already sold; the whole void then rolls back.
      postMovement(db, { variantId: l.variant_id, qtyDelta: -l.qty, batchId: l.batch_id, type: "purchase_void", sourceType: "purchase", sourceId: purchaseId, note: reason, userId: actor.userId, ts })
    }
    addLedgerEntry(db, { ts, partyKind: "supplier", partyId: p.supplier_id, debit: p.total, kind: "purchase_void", sourceType: "purchase", sourceId: purchaseId, description: `Void ${p.purchase_no}`, userId: actor.userId })
    if (p.paid > 0) {
      addLedgerEntry(db, { ts, partyKind: "supplier", partyId: p.supplier_id, credit: p.paid, kind: "purchase_void", sourceType: "purchase", sourceId: purchaseId, description: `Payment reversed for ${p.purchase_no}`, userId: actor.userId })
    }
    const pays = db.prepare("SELECT account_id, amount FROM purchase_payments WHERE purchase_id = ?").all(purchaseId) as { account_id: number; amount: number }[]
    for (const x of pays) {
      addAccountEntry(db, { ts, accountId: x.account_id, amount: x.amount, kind: "void_reversal", sourceType: "purchase", sourceId: purchaseId, description: `Void ${p.purchase_no}`, userId: actor.userId })
    }
    db.prepare("UPDATE purchases SET status='void', void_reason=?, voided_at=?, voided_by=? WHERE id=?").run(reason, ts, actor.userId, purchaseId)
    audit(db, actor.userId, "purchase.void", "purchase", purchaseId, { purchaseNo: p.purchase_no, reason })
  })
}
