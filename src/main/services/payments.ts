import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { requirePermission, type Actor } from "@core/permissions"
import { audit, getSetting, nextDocNo, tx } from "../db/util"
import { addAccountEntry, addLedgerEntry } from "./posting"
import { assertFlag, resolveTimestamp } from "./policy"
import { postMovement } from "./stock"
import { customerBalance, supplierBalance } from "./queries"
import { cleanInvoiceNo } from "./sales"

export interface ReceiptInput {
  partyId: number
  accountId: number
  method: string
  amount: number
  ts?: string
  reference?: string
  notes?: string
  receivedBy?: string
}

function checkAccount(db: DB, accountId: number): void {
  const a = db.prepare("SELECT active FROM accounts WHERE id = ?").get(accountId) as { active: number } | undefined
  if (!a || !a.active) throw new AppError("NOT_FOUND", "Account not found or inactive")
}

/** Recovery / party payment. Credits the party ledger and the chosen account. It is not a sale and not income. */
export function recordReceipt(db: DB, actor: Actor, input: ReceiptInput): { paymentId: number; docNo: string; balanceAfter: number } {
  requirePermission(actor, "payment.create")
  return tx(db, () => {
    assertFlag(db, "recovery")
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Enter an amount greater than zero")
    const party = db.prepare("SELECT id, status FROM parties WHERE id = ?").get(input.partyId) as { id: number; status: string } | undefined
    if (!party) throw new AppError("NOT_FOUND", "Party not found")
    checkAccount(db, input.accountId)
    const before = customerBalance(db, party.id)
    if (getSetting(db, "receipts.allow_overpayment", "off") !== "on" && input.amount > Math.max(before, 0)) {
      throw new AppError("VALIDATION", "Collection cannot exceed the outstanding balance")
    }
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const docNo = freePaymentNo(db, "receipt")
    const paymentId = Number(
      db
        .prepare(
          `INSERT INTO payments(doc_no, ts, kind, party_id, account_id, method, amount, reference, notes, received_by, user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(docNo, ts, "customer_receipt", party.id, input.accountId, input.method, input.amount, input.reference ?? null, input.notes ?? null, input.receivedBy ?? null, actor.userId).lastInsertRowid,
    )
    addLedgerEntry(db, { ts, partyKind: "customer", partyId: party.id, credit: input.amount, kind: "receipt", sourceType: "payment", sourceId: paymentId, description: `Payment ${docNo}`, userId: actor.userId })
    addAccountEntry(db, { ts, accountId: input.accountId, amount: input.amount, kind: "customer_receipt", sourceType: "payment", sourceId: paymentId, description: `Receipt ${docNo}`, userId: actor.userId })
    audit(db, actor.userId, "payment.receipt", "payment", paymentId, { docNo, amount: input.amount, partyId: party.id })
    return { paymentId, docNo, balanceAfter: before - input.amount }
  })
}

export function recordSupplierPayment(db: DB, actor: Actor, input: ReceiptInput): { paymentId: number; docNo: string; payableAfter: number } {
  requirePermission(actor, "payment.create")
  return tx(db, () => {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Enter an amount greater than zero")
    const sup = db.prepare("SELECT id FROM suppliers WHERE id = ?").get(input.partyId) as { id: number } | undefined
    if (!sup) throw new AppError("NOT_FOUND", "Supplier not found")
    checkAccount(db, input.accountId)
    const before = supplierBalance(db, sup.id)
    if (input.amount > Math.max(before, 0)) throw new AppError("VALIDATION", "Payment cannot exceed the supplier payable")
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const docNo = freePaymentNo(db, "payment")
    const paymentId = Number(
      db
        .prepare(
          `INSERT INTO payments(doc_no, ts, kind, party_id, account_id, method, amount, reference, notes, user_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(docNo, ts, "supplier_payment", sup.id, input.accountId, input.method, input.amount, input.reference ?? null, input.notes ?? null, actor.userId).lastInsertRowid,
    )
    addLedgerEntry(db, { ts, partyKind: "supplier", partyId: sup.id, debit: input.amount, kind: "payment", sourceType: "payment", sourceId: paymentId, description: `Payment ${docNo}`, userId: actor.userId })
    addAccountEntry(db, { ts, accountId: input.accountId, amount: -input.amount, kind: "supplier_payment", sourceType: "payment", sourceId: paymentId, description: `Supplier payment ${docNo}`, userId: actor.userId })
    audit(db, actor.userId, "payment.supplier", "payment", paymentId, { docNo, amount: input.amount, supplierId: sup.id })
    return { paymentId, docNo, payableAfter: before - input.amount }
  })
}

export function recordExpense(
  db: DB,
  actor: Actor,
  input: { categoryId: number; amount: number; accountId: number; description?: string; reference?: string; ts?: string },
): number {
  requirePermission(actor, "expense.create")
  return tx(db, () => {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Enter an amount greater than zero")
    if (!db.prepare("SELECT 1 FROM expense_categories WHERE id = ?").get(input.categoryId)) throw new AppError("NOT_FOUND", "Expense category not found")
    checkAccount(db, input.accountId)
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const id = Number(
      db
        .prepare("INSERT INTO expenses(ts, category_id, amount, account_id, description, reference, user_id) VALUES (?,?,?,?,?,?,?)")
        .run(ts, input.categoryId, input.amount, input.accountId, input.description ?? null, input.reference ?? null, actor.userId).lastInsertRowid,
    )
    addAccountEntry(db, { ts, accountId: input.accountId, amount: -input.amount, kind: "expense", sourceType: "expense", sourceId: id, description: input.description, userId: actor.userId })
    audit(db, actor.userId, "expense.create", "expense", id, { amount: input.amount })
    return id
  })
}

/** Moves money between accounts. Never counted as income or expense. */
export function postTransfer(db: DB, actor: Actor, input: { fromAccountId: number; toAccountId: number; amount: number; note?: string; ts?: string }): number {
  requirePermission(actor, "payment.create")
  return tx(db, () => {
    if (input.fromAccountId === input.toAccountId) throw new AppError("VALIDATION", "Choose two different accounts")
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", "Enter an amount greater than zero")
    checkAccount(db, input.fromAccountId)
    checkAccount(db, input.toAccountId)
    const ts = resolveTimestamp(db, actor, input.ts, "sale.backdate")
    const id = Number(
      db.prepare("INSERT INTO account_transfers(ts, from_account_id, to_account_id, amount, note, user_id) VALUES (?,?,?,?,?,?)").run(ts, input.fromAccountId, input.toAccountId, input.amount, input.note ?? null, actor.userId).lastInsertRowid,
    )
    const fromName = (db.prepare("SELECT name FROM accounts WHERE id = ?").get(input.fromAccountId) as { name: string }).name
    const toName = (db.prepare("SELECT name FROM accounts WHERE id = ?").get(input.toAccountId) as { name: string }).name
    addAccountEntry(db, { ts, accountId: input.fromAccountId, amount: -input.amount, kind: "transfer_out", sourceType: "transfer", sourceId: id, description: input.note ? `Transfer to ${toName}: ${input.note}` : `Transfer to ${toName}`, userId: actor.userId })
    addAccountEntry(db, { ts, accountId: input.toAccountId, amount: input.amount, kind: "transfer_in", sourceType: "transfer", sourceId: id, description: input.note ? `Transfer from ${fromName}: ${input.note}` : `Transfer from ${fromName}`, userId: actor.userId })
    audit(db, actor.userId, "transfer.create", "transfer", id, { amount: input.amount })
    return id
  })
}

// ---------- Opening balances and stock adjustments ----------

/** Customer: positive = they owe us. Supplier: positive = we owe them. Negative values are advances. */
export function postOpeningPartyBalance(db: DB, actor: Actor, input: { kind: "customer" | "supplier"; partyId: number; amount: number; ts?: string }): void {
  requirePermission(actor, "ledger.adjust")
  tx(db, () => {
    if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new AppError("VALIDATION", "Enter a non-zero amount")
    const table = input.kind === "customer" ? "parties" : "suppliers"
    if (!db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(input.partyId)) throw new AppError("NOT_FOUND", "Party not found")
    const ts = input.ts ?? new Date().toISOString()
    const abs = Math.abs(input.amount)
    const owedToUs = input.kind === "customer" ? input.amount > 0 : input.amount < 0
    addLedgerEntry(db, {
      ts,
      partyKind: input.kind,
      partyId: input.partyId,
      debit: input.kind === "customer" ? (input.amount > 0 ? abs : 0) : owedToUs ? abs : 0,
      credit: input.kind === "customer" ? (input.amount < 0 ? abs : 0) : owedToUs ? 0 : abs,
      kind: "opening",
      description: "Opening balance",
      userId: actor.userId,
    })
    audit(db, actor.userId, "opening.party", input.kind, input.partyId, { amount: input.amount })
  })
}

export function postOpeningAccountBalance(db: DB, actor: Actor, input: { accountId: number; amount: number; ts?: string }): void {
  requirePermission(actor, "ledger.adjust")
  tx(db, () => {
    if (!Number.isSafeInteger(input.amount) || input.amount === 0) throw new AppError("VALIDATION", "Enter a non-zero amount")
    checkAccount(db, input.accountId)
    addAccountEntry(db, { ts: input.ts ?? new Date().toISOString(), accountId: input.accountId, amount: input.amount, kind: "opening", description: "Opening balance", userId: actor.userId })
    audit(db, actor.userId, "opening.account", "account", input.accountId, { amount: input.amount })
  })
}

export function postOpeningStock(db: DB, actor: Actor, input: { variantId: number; qty: number; unitCost: number; ts?: string }): void {
  requirePermission(actor, "stock.adjust")
  tx(db, () => {
    postMovement(db, { variantId: input.variantId, qtyDelta: input.qty, unitCost: input.unitCost, type: "opening", sourceType: "opening", userId: actor.userId, ts: input.ts ?? new Date().toISOString() })
    audit(db, actor.userId, "opening.stock", "variant", input.variantId, { qty: input.qty, unitCost: input.unitCost })
  })
}

/** Controlled stock adjustment: needs permission and a reason, and is audited. */
export function adjustStock(db: DB, actor: Actor, input: { variantId: number; qtyDelta: number; reason: string; type?: "adjustment_in" | "adjustment_out" | "damage" }): void {
  requirePermission(actor, "stock.adjust")
  if (!input.reason.trim()) throw new AppError("VALIDATION", "A reason is required for a stock adjustment")
  tx(db, () => {
    const increase = input.qtyDelta > 0
    const type = increase ? "adjustment_in" : (input.type ?? "adjustment_out")
    const avg = (db.prepare("SELECT avg_cost FROM stock_levels WHERE variant_id = ?").get(input.variantId) as { avg_cost: number } | undefined)?.avg_cost ?? 0
    postMovement(db, { variantId: input.variantId, qtyDelta: input.qtyDelta, unitCost: increase ? avg : undefined, type, sourceType: "adjustment", note: input.reason, userId: actor.userId, ts: new Date().toISOString() })
    audit(db, actor.userId, "stock.adjust", "variant", input.variantId, { qtyDelta: input.qtyDelta, reason: input.reason })
  })
}

export function paymentNoTaken(db: DB, no: string, exceptId = 0): boolean {
  return db.prepare("SELECT 1 FROM payments WHERE doc_no = ? COLLATE NOCASE AND id != ?").get(no, exceptId) !== undefined
}

/** The automatic number, skipping any that a typed number has already used. */
function freePaymentNo(db: DB, kind: "receipt" | "payment"): string {
  for (let i = 0; i < 100000; i++) {
    const no = nextDocNo(db, kind)
    if (!paymentNoTaken(db, no)) return no
  }
  throw new AppError("INTERNAL", "No free number")
}

/** Changes only the number written on a receipt or supplier pay slip. Amounts and balances stay as they are. */
export function renumberPayment(db: DB, actor: Actor, paymentId: number, raw: string): string {
  requirePermission(actor, "ledger.adjust")
  const no = cleanInvoiceNo(raw)
  if (!no) throw new AppError("VALIDATION", "Type the number")
  return tx(db, () => {
    const p = db.prepare("SELECT doc_no FROM payments WHERE id = ?").get(paymentId) as { doc_no: string } | undefined
    if (!p) throw new AppError("NOT_FOUND", "Payment not found")
    if (p.doc_no === no) return no
    if (paymentNoTaken(db, no, paymentId)) throw new AppError("VALIDATION", `Number ${no} is already used`)
    db.prepare("UPDATE payments SET doc_no = ? WHERE id = ?").run(no, paymentId)
    for (const table of ["ledger_entries", "account_entries"]) {
      db.prepare(`UPDATE ${table} SET description = REPLACE(description, ?, ?) WHERE source_type = 'payment' AND source_id = ?`).run(p.doc_no, no, paymentId)
    }
    audit(db, actor.userId, "payment.renumber", "payment", paymentId, { from: p.doc_no, to: no })
    return no
  })
}

const autoExpenseNo = (id: number) => `EXP-${String(id).padStart(4, "0")}`

/** The number shown for an expense: the one typed by the user, else EXP-0001 style. */
export function expenseNoTaken(db: DB, no: string, exceptId = 0): boolean {
  if (db.prepare("SELECT 1 FROM expenses WHERE reference = ? COLLATE NOCASE AND id != ?").get(no, exceptId)) return true
  const m = /^EXP-0*(\d+)$/i.exec(no)
  if (m) {
    const other = db.prepare("SELECT id, reference FROM expenses WHERE id = ?").get(Number(m[1])) as { id: number; reference: string | null } | undefined
    if (other && other.id !== exceptId && !other.reference) return true
  }
  return false
}

export function renumberExpense(db: DB, actor: Actor, expenseId: number, raw: string): string {
  requirePermission(actor, "ledger.adjust")
  const no = cleanInvoiceNo(raw)
  if (!no) throw new AppError("VALIDATION", "Type the number")
  return tx(db, () => {
    const e = db.prepare("SELECT id, reference FROM expenses WHERE id = ?").get(expenseId) as { id: number; reference: string | null } | undefined
    if (!e) throw new AppError("NOT_FOUND", "Expense not found")
    const old = e.reference || autoExpenseNo(e.id)
    if (old === no) return no
    if (expenseNoTaken(db, no, expenseId)) throw new AppError("VALIDATION", `Number ${no} is already used`)
    db.prepare("UPDATE expenses SET reference = ? WHERE id = ?").run(no, expenseId)
    audit(db, actor.userId, "expense.renumber", "expense", expenseId, { from: old, to: no })
    return no
  })
}
