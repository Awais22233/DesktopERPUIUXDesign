import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { can, requirePermission, type Actor } from "@core/permissions"
import { audit, getSetting, nextDocNo, tx } from "../db/util"
import { postMovement } from "./stock"
import { addAccountEntry, addLedgerEntry } from "./posting"
import { postSale, type SaleInput, type SaleResult } from "./sales"

export interface SaleReturnLineInput {
  /** Return against an invoice line. */
  saleLineId?: number
  /** Return without an invoice (needs permission): variant and price are given explicitly. */
  variantId?: number
  unitPrice?: number
  qty: number
  damaged?: boolean
}
export interface SaleReturnInput {
  saleId?: number
  /** Required only for a return without an invoice. */
  partyId?: number
  lines: SaleReturnLineInput[]
  /** "balance": credit the party's account. "cash": also pay `refundAmount` back from `accountId`. */
  settlement: "balance" | "cash"
  accountId?: number
  refundAmount?: number
  reason?: string
}
export interface ReturnResult {
  returnId: number
  returnNo: string
  total: number
  refunded: number
}

const DAY = 86_400_000

/** Value of one invoice line after its share of any invoice-level discount. */
function effectiveLineTotal(db: DB, saleId: number, line: { id: number; line_total: number }): number {
  const sale = db.prepare("SELECT discount FROM sales WHERE id = ?").get(saleId) as { discount: number }
  const sums = db.prepare("SELECT SUM(line_total) AS t, SUM(discount) AS d FROM sale_lines WHERE sale_id = ?").get(saleId) as { t: number; d: number }
  const extra = sale.discount - sums.d
  if (extra <= 0 || sums.t <= 0) return line.line_total
  return line.line_total - Math.round((extra * line.line_total) / sums.t)
}

export function postSaleReturn(db: DB, actor: Actor, input: SaleReturnInput): ReturnResult {
  requirePermission(actor, "return.create")
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Select at least one item to return")
  if (!input.saleId) requirePermission(actor, "return.no_invoice")

  return tx(db, () => {
    const ts = new Date().toISOString()
    let partyId: number
    let saleNo = ""
    if (input.saleId) {
      const sale = db.prepare("SELECT id, invoice_no, party_id, ts, status FROM sales WHERE id = ?").get(input.saleId) as
        | { id: number; invoice_no: string; party_id: number; ts: string; status: string }
        | undefined
      if (!sale) throw new AppError("NOT_FOUND", "Sale not found")
      if (sale.status !== "completed") throw new AppError("INVALID_STATE", "A cancelled sale cannot be returned")
      const windowDays = Number(getSetting(db, "returns.window_days", "0"))
      if (windowDays > 0 && (Date.now() - new Date(sale.ts).getTime()) / DAY > windowDays && !can(actor, "return.no_invoice")) {
        throw new AppError("VALIDATION", `Returns are accepted within ${windowDays} days of the sale`)
      }
      partyId = sale.party_id
      saleNo = sale.invoice_no
    } else {
      if (!input.partyId) throw new AppError("VALIDATION", "Select the party for a return without invoice")
      if (!db.prepare("SELECT 1 FROM parties WHERE id = ?").get(input.partyId)) throw new AppError("NOT_FOUND", "Party not found")
      partyId = input.partyId
    }

    const prepared = input.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("VALIDATION", "Return quantity must be a whole number greater than zero")
      if (input.saleId) {
        if (!l.saleLineId) throw new AppError("VALIDATION", "Select the invoice line to return")
        const sl = db.prepare("SELECT id, variant_id, qty, line_total, unit_cost FROM sale_lines WHERE id = ? AND sale_id = ?").get(l.saleLineId, input.saleId) as
          | { id: number; variant_id: number; qty: number; line_total: number; unit_cost: number }
          | undefined
        if (!sl) throw new AppError("NOT_FOUND", "Invoice line not found")
        const done = db.prepare("SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(amount),0) a FROM sale_return_lines WHERE sale_line_id = ?").get(sl.id) as { q: number; a: number }
        if (l.qty > sl.qty - done.q) throw new AppError("VALIDATION", `Only ${sl.qty - done.q} can still be returned for this item`)
        const effective = effectiveLineTotal(db, input.saleId, sl)
        const remainingValue = effective - done.a
        const amount = l.qty === sl.qty - done.q ? remainingValue : Math.min(Math.round((effective * l.qty) / sl.qty), remainingValue)
        return { saleLineId: sl.id, variantId: sl.variant_id, qty: l.qty, amount, unitCost: sl.unit_cost, damaged: !!l.damaged }
      }
      if (!l.variantId || l.unitPrice === undefined || !Number.isSafeInteger(l.unitPrice) || l.unitPrice < 0) throw new AppError("VALIDATION", "Item and price are required")
      const avg = (db.prepare("SELECT avg_cost FROM stock_levels WHERE variant_id = ?").get(l.variantId) as { avg_cost: number } | undefined)?.avg_cost ?? 0
      return { saleLineId: null, variantId: l.variantId, qty: l.qty, amount: l.unitPrice * l.qty, unitCost: avg, damaged: !!l.damaged }
    })

    const total = prepared.reduce((s, l) => s + l.amount, 0)
    if (total <= 0) throw new AppError("VALIDATION", "The return value must be greater than zero")

    let refunded = 0
    let accountId: number | null = null
    if (input.settlement === "cash") {
      refunded = input.refundAmount ?? total
      if (!Number.isSafeInteger(refunded) || refunded <= 0 || refunded > total) throw new AppError("VALIDATION", "Refund cannot exceed the return value")
      const acc = input.accountId ? (db.prepare("SELECT id, active FROM accounts WHERE id = ?").get(input.accountId) as { id: number; active: number } | undefined) : undefined
      if (!acc || !acc.active) throw new AppError("VALIDATION", "Choose the account the refund is paid from")
      accountId = acc.id
    }

    const returnNo = nextDocNo(db, "sale_return")
    const returnId = Number(
      db
        .prepare("INSERT INTO sale_returns(return_no, ts, sale_id, party_id, total, refunded, account_id, reason, user_id) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(returnNo, ts, input.saleId ?? null, partyId, total, refunded, accountId, input.reason ?? null, actor.userId).lastInsertRowid,
    )
    for (const l of prepared) {
      db.prepare("INSERT INTO sale_return_lines(return_id, sale_line_id, variant_id, qty, amount, unit_cost, damaged) VALUES (?,?,?,?,?,?,?)").run(
        returnId, l.saleLineId, l.variantId, l.qty, l.amount, l.unitCost, l.damaged ? 1 : 0,
      )
      postMovement(db, { variantId: l.variantId, qtyDelta: l.qty, unitCost: l.unitCost, type: "sale_return", sourceType: "sale_return", sourceId: returnId, note: saleNo || "Return without invoice", userId: actor.userId, ts })
      if (l.damaged) {
        // Booked back in, then written off, so the stock history shows exactly what happened.
        postMovement(db, { variantId: l.variantId, qtyDelta: -l.qty, type: "damage", sourceType: "sale_return", sourceId: returnId, note: "Damaged on return", userId: actor.userId, ts, allowNegative: true })
      }
    }
    addLedgerEntry(db, { ts, partyKind: "customer", partyId, credit: total, kind: "sale_return", sourceType: "sale_return", sourceId: returnId, description: `Return ${returnNo}${saleNo ? ` (${saleNo})` : ""}`, userId: actor.userId })
    if (refunded > 0) {
      addAccountEntry(db, { ts, accountId: accountId!, amount: -refunded, kind: "refund", sourceType: "sale_return", sourceId: returnId, description: `Refund ${returnNo}`, userId: actor.userId })
      addLedgerEntry(db, { ts, partyKind: "customer", partyId, debit: refunded, kind: "sale_return", sourceType: "sale_return", sourceId: returnId, description: `Cash refund ${returnNo}`, userId: actor.userId })
    }
    audit(db, actor.userId, "return.sale", "sale_return", returnId, { returnNo, total, refunded, saleId: input.saleId ?? null })
    return { returnId, returnNo, total, refunded }
  })
}

export interface PurchaseReturnInput {
  purchaseId: number
  lines: { purchaseLineId: number; qty: number }[]
  /** Cash received back from the supplier, paid into `accountId`. */
  refundAmount?: number
  accountId?: number
  reason?: string
}

export function postPurchaseReturn(db: DB, actor: Actor, input: PurchaseReturnInput): ReturnResult {
  requirePermission(actor, "return.create")
  if (input.lines.length === 0) throw new AppError("VALIDATION", "Select at least one item to return")
  return tx(db, () => {
    const ts = new Date().toISOString()
    const p = db.prepare("SELECT id, purchase_no, supplier_id, status FROM purchases WHERE id = ?").get(input.purchaseId) as
      | { id: number; purchase_no: string; supplier_id: number; status: string }
      | undefined
    if (!p) throw new AppError("NOT_FOUND", "Purchase not found")
    if (p.status !== "completed") throw new AppError("INVALID_STATE", "A cancelled purchase cannot be returned")

    const prepared = input.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty <= 0) throw new AppError("VALIDATION", "Return quantity must be a whole number greater than zero")
      const pl = db.prepare("SELECT id, variant_id, qty, line_total FROM purchase_lines WHERE id = ? AND purchase_id = ?").get(l.purchaseLineId, p.id) as
        | { id: number; variant_id: number; qty: number; line_total: number }
        | undefined
      if (!pl) throw new AppError("NOT_FOUND", "Purchase line not found")
      const done = db.prepare("SELECT COALESCE(SUM(qty),0) q, COALESCE(SUM(amount),0) a FROM purchase_return_lines WHERE purchase_line_id = ?").get(pl.id) as { q: number; a: number }
      if (l.qty > pl.qty - done.q) throw new AppError("VALIDATION", `Only ${pl.qty - done.q} can still be returned for this item`)
      const remaining = pl.line_total - done.a
      const amount = l.qty === pl.qty - done.q ? remaining : Math.min(Math.round((pl.line_total * l.qty) / pl.qty), remaining)
      return { purchaseLineId: pl.id, variantId: pl.variant_id, qty: l.qty, amount }
    })
    const total = prepared.reduce((s, l) => s + l.amount, 0)
    if (total <= 0) throw new AppError("VALIDATION", "The return value must be greater than zero")

    let refunded = 0
    let accountId: number | null = null
    if (input.refundAmount && input.refundAmount > 0) {
      refunded = input.refundAmount
      if (!Number.isSafeInteger(refunded) || refunded > total) throw new AppError("VALIDATION", "Refund cannot exceed the return value")
      const acc = input.accountId ? (db.prepare("SELECT id, active FROM accounts WHERE id = ?").get(input.accountId) as { id: number; active: number } | undefined) : undefined
      if (!acc || !acc.active) throw new AppError("VALIDATION", "Choose the account the refund is paid into")
      accountId = acc.id
    }

    const returnNo = nextDocNo(db, "purchase_return")
    const returnId = Number(
      db
        .prepare("INSERT INTO purchase_returns(return_no, ts, purchase_id, supplier_id, total, refunded, account_id, reason, user_id) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(returnNo, ts, p.id, p.supplier_id, total, refunded, accountId, input.reason ?? null, actor.userId).lastInsertRowid,
    )
    for (const l of prepared) {
      // Fails with INSUFFICIENT_STOCK if the goods were already sold; the whole return then rolls back.
      postMovement(db, { variantId: l.variantId, qtyDelta: -l.qty, type: "purchase_return", sourceType: "purchase_return", sourceId: returnId, note: p.purchase_no, userId: actor.userId, ts })
      db.prepare("INSERT INTO purchase_return_lines(return_id, purchase_line_id, variant_id, qty, amount) VALUES (?,?,?,?,?)").run(returnId, l.purchaseLineId, l.variantId, l.qty, l.amount)
    }
    addLedgerEntry(db, { ts, partyKind: "supplier", partyId: p.supplier_id, debit: total, kind: "purchase_return", sourceType: "purchase_return", sourceId: returnId, description: `Return ${returnNo} (${p.purchase_no})`, userId: actor.userId })
    if (refunded > 0) {
      addAccountEntry(db, { ts, accountId: accountId!, amount: refunded, kind: "refund", sourceType: "purchase_return", sourceId: returnId, description: `Supplier refund ${returnNo}`, userId: actor.userId })
      addLedgerEntry(db, { ts, partyKind: "supplier", partyId: p.supplier_id, credit: refunded, kind: "purchase_return", sourceType: "purchase_return", sourceId: returnId, description: `Cash refund ${returnNo}`, userId: actor.userId })
    }
    audit(db, actor.userId, "return.purchase", "purchase_return", returnId, { returnNo, total, refunded, purchaseId: p.id })
    return { returnId, returnNo, total, refunded }
  })
}

/** Exchange = return of old goods + a new linked sale, in one transaction. The difference is settled on the new sale. */
export function postExchange(db: DB, actor: Actor, input: { ret: Omit<SaleReturnInput, "settlement">; sale: SaleInput }): { ret: ReturnResult; sale: SaleResult } {
  return tx(db, () => {
    const ret = postSaleReturn(db, actor, { ...input.ret, settlement: "balance" })
    const sale = postSale(db, actor, input.sale)
    audit(db, actor.userId, "exchange", "sale", sale.saleId, { returnNo: ret.returnNo, invoiceNo: sale.invoiceNo })
    return { ret, sale }
  })
}
