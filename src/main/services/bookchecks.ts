import type { DB } from "../db/connection"
import { profitSummary, stockReconcile } from "./queries"

/**
 * Independent proof that the books are right: every balance is recomputed from the business documents
 * (invoices, payments, returns, expenses, transfers) and compared with what the ledgers and caches say.
 * Every list below must be empty on a healthy database, and `accountingIdentity().difference` must be 0.
 */
export interface Mismatch {
  id: number
  recorded: number
  fromDocuments: number
}
export interface BookCheckResult {
  customers: Mismatch[]
  suppliers: Mismatch[]
  accounts: Mismatch[]
  stock: ReturnType<typeof stockReconcile>
  documents: string[]
}

type Pair = { id: number; v: number }

function toMap(rows: Pair[]): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows) m.set(r.id, (m.get(r.id) ?? 0) + r.v)
  return m
}

function compare(recorded: Map<number, number>, docs: Map<number, number>): Mismatch[] {
  const out: Mismatch[] = []
  for (const id of new Set([...recorded.keys(), ...docs.keys()])) {
    const a = recorded.get(id) ?? 0
    const b = docs.get(id) ?? 0
    if (a !== b) out.push({ id, recorded: a, fromDocuments: b })
  }
  return out
}

export function bookChecks(db: DB): BookCheckResult {
  const q = (sql: string) => db.prepare(sql).all() as Pair[]

  // ---- customers: balance = what they owe us
  const customerLedger = toMap(q("SELECT party_id id, SUM(debit) - SUM(credit) v FROM ledger_entries WHERE party_kind='customer' GROUP BY party_id"))
  const customerDocs = toMap([
    ...q("SELECT party_id id, debit - credit v FROM ledger_entries WHERE party_kind='customer' AND kind IN ('opening','adjustment')"),
    ...q("SELECT party_id id, total - paid v FROM sales WHERE status='completed'"),
    ...q("SELECT party_id id, -amount v FROM payments WHERE kind='customer_receipt' AND status='posted'"),
    ...q("SELECT party_id id, -(total - refunded) v FROM sale_returns"),
  ])

  // ---- suppliers: balance = what we owe them
  const supplierLedger = toMap(q("SELECT party_id id, SUM(credit) - SUM(debit) v FROM ledger_entries WHERE party_kind='supplier' GROUP BY party_id"))
  const supplierDocs = toMap([
    ...q("SELECT party_id id, credit - debit v FROM ledger_entries WHERE party_kind='supplier' AND kind IN ('opening','adjustment')"),
    ...q("SELECT supplier_id id, total - paid v FROM purchases WHERE status='completed'"),
    ...q("SELECT party_id id, -amount v FROM payments WHERE kind='supplier_payment' AND status='posted'"),
    ...q("SELECT supplier_id id, -(total - refunded) v FROM purchase_returns"),
  ])

  // ---- cash / bank accounts
  const accountEntries = toMap(q("SELECT account_id id, SUM(amount) v FROM account_entries GROUP BY account_id"))
  const accountDocs = toMap([
    ...q("SELECT account_id id, amount v FROM account_entries WHERE kind IN ('opening','adjustment')"),
    ...q("SELECT p.account_id id, p.amount v FROM sale_payments p JOIN sales s ON s.id = p.sale_id WHERE s.status='completed'"),
    ...q("SELECT account_id id, amount v FROM payments WHERE kind='customer_receipt' AND status='posted'"),
    ...q("SELECT account_id id, -amount v FROM payments WHERE kind='supplier_payment' AND status='posted'"),
    ...q("SELECT p.account_id id, -p.amount v FROM purchase_payments p JOIN purchases s ON s.id = p.purchase_id WHERE s.status='completed'"),
    ...q("SELECT account_id id, -amount v FROM expenses"),
    ...q("SELECT from_account_id id, -amount v FROM account_transfers"),
    ...q("SELECT to_account_id id, amount v FROM account_transfers"),
    ...q("SELECT account_id id, -refunded v FROM sale_returns WHERE refunded > 0"),
    ...q("SELECT account_id id, refunded v FROM purchase_returns WHERE refunded > 0"),
  ])

  // ---- stock movements against the documents that caused them (all documents, void or not)
  const documents: string[] = []
  const one = (sql: string) => (db.prepare(sql).get() as { v: number }).v
  const checks: [string, string, string][] = [
    ["sale", "SELECT COALESCE(-SUM(qty_delta),0) v FROM stock_movements WHERE type='sale'", "SELECT COALESCE(SUM(qty),0) v FROM sale_lines"],
    ["sale void", "SELECT COALESCE(SUM(qty_delta),0) v FROM stock_movements WHERE type='sale_void'", "SELECT COALESCE(SUM(l.qty),0) v FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.status='void'"],
    ["purchase", "SELECT COALESCE(SUM(qty_delta),0) v FROM stock_movements WHERE type='purchase'", "SELECT COALESCE(SUM(qty),0) v FROM purchase_lines"],
    ["purchase void", "SELECT COALESCE(-SUM(qty_delta),0) v FROM stock_movements WHERE type='purchase_void'", "SELECT COALESCE(SUM(l.qty),0) v FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id WHERE p.status='void'"],
    ["sale return", "SELECT COALESCE(SUM(qty_delta),0) v FROM stock_movements WHERE type='sale_return'", "SELECT COALESCE(SUM(qty),0) v FROM sale_return_lines"],
    ["purchase return", "SELECT COALESCE(-SUM(qty_delta),0) v FROM stock_movements WHERE type='purchase_return'", "SELECT COALESCE(SUM(qty),0) v FROM purchase_return_lines"],
  ]
  for (const [name, a, b] of checks) {
    const x = one(a)
    const y = one(b)
    if (x !== y) documents.push(`${name}: stock movements say ${x}, documents say ${y}`)
  }
  // Header totals must equal their lines.
  const bad = (sql: string, text: string) => {
    const n = one(sql)
    if (n) documents.push(`${text}: ${n}`)
  }
  bad("SELECT COUNT(*) v FROM sales s WHERE s.subtotal <> (SELECT COALESCE(SUM(qty*rate),0) FROM sale_lines WHERE sale_id=s.id)", "Sales whose subtotal differs from their lines")
  bad("SELECT COUNT(*) v FROM sales s WHERE s.paid <> (SELECT COALESCE(SUM(amount),0) FROM sale_payments WHERE sale_id=s.id)", "Sales whose paid amount differs from their payments")
  bad("SELECT COUNT(*) v FROM purchases s WHERE s.paid <> (SELECT COALESCE(SUM(amount),0) FROM purchase_payments WHERE purchase_id=s.id)", "Purchases whose paid amount differs from their payments")
  bad("SELECT COUNT(*) v FROM sale_returns r WHERE r.total <> (SELECT COALESCE(SUM(amount),0) FROM sale_return_lines WHERE return_id=r.id)", "Sale returns whose total differs from their lines")
  bad("SELECT COUNT(*) v FROM purchase_returns r WHERE r.total <> (SELECT COALESCE(SUM(amount),0) FROM purchase_return_lines WHERE return_id=r.id)", "Purchase returns whose total differs from their lines")
  bad("SELECT COUNT(*) v FROM sale_lines l WHERE l.cost_total <> (SELECT COALESCE(-SUM(value),0) FROM stock_movements WHERE type='sale' AND source_type='sale' AND source_id=l.sale_id AND variant_id=l.variant_id) AND (SELECT COUNT(*) FROM sale_lines x WHERE x.sale_id=l.sale_id AND x.variant_id=l.variant_id)=1", "Sale lines whose cost differs from the stock taken out")

  return { customers: compare(customerLedger, customerDocs), suppliers: compare(supplierLedger, supplierDocs), accounts: compare(accountEntries, accountDocs), stock: stockReconcile(db), documents }
}

export interface Identity {
  cashAndBank: number
  receivables: number
  stockValue: number
  payables: number
  netAssets: number
  openingPosition: number
  netProfit: number
  /** netAssets - openingPosition - netProfit. Must be exactly 0. */
  difference: number
}

/** cash + bank + receivables + stock - payables = opening position + net profit, to the paisa. */
export function accountingIdentity(db: DB): Identity {
  const n = (sql: string) => (db.prepare(sql).get() as { v: number }).v
  const cashAndBank = n("SELECT COALESCE(SUM(amount),0) v FROM account_entries")
  const receivables = n("SELECT COALESCE(SUM(debit)-SUM(credit),0) v FROM ledger_entries WHERE party_kind='customer'")
  const payables = n("SELECT COALESCE(SUM(credit)-SUM(debit),0) v FROM ledger_entries WHERE party_kind='supplier'")
  const stockValue = n("SELECT COALESCE(SUM(value),0) v FROM stock_levels")
  const netAssets = cashAndBank + receivables + stockValue - payables
  const openingPosition =
    n("SELECT COALESCE(SUM(amount),0) v FROM account_entries WHERE kind IN ('opening','adjustment')") +
    n("SELECT COALESCE(SUM(debit)-SUM(credit),0) v FROM ledger_entries WHERE party_kind='customer' AND kind IN ('opening','adjustment')") -
    n("SELECT COALESCE(SUM(credit)-SUM(debit),0) v FROM ledger_entries WHERE party_kind='supplier' AND kind IN ('opening','adjustment')") +
    n("SELECT COALESCE(SUM(value),0) v FROM stock_movements WHERE type='opening'")
  const netProfit = profitSummary(db, "0000", "9999").netProfit
  return { cashAndBank, receivables, stockValue, payables, netAssets, openingPosition, netProfit, difference: netAssets - openingPosition - netProfit }
}
