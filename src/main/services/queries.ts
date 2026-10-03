import type { DB } from "../db/connection"

export function customerBalance(db: DB, partyId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(debit) - SUM(credit), 0) AS b FROM ledger_entries WHERE party_kind='customer' AND party_id=?").get(partyId) as { b: number }
  return r.b
}

export function supplierBalance(db: DB, supplierId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(credit) - SUM(debit), 0) AS b FROM ledger_entries WHERE party_kind='supplier' AND party_id=?").get(supplierId) as { b: number }
  return r.b
}

export function accountBalance(db: DB, accountId: number): number {
  const r = db.prepare("SELECT COALESCE(SUM(amount), 0) AS b FROM account_entries WHERE account_id=?").get(accountId) as { b: number }
  return r.b
}

export interface LedgerRow {
  id: number
  ts: string
  description: string | null
  kind: string
  debit: number
  credit: number
  balance: number
}

/** Running-balance statement. For customers balance = debit - credit; for suppliers credit - debit. */
export function partyLedger(db: DB, kind: "customer" | "supplier", partyId: number): LedgerRow[] {
  const expr = kind === "customer" ? "debit - credit" : "credit - debit"
  return db
    .prepare(
      `SELECT id, ts, description, kind, debit, credit,
              SUM(${expr}) OVER (ORDER BY ts, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance
       FROM ledger_entries WHERE party_kind = ? AND party_id = ? ORDER BY ts, id`,
    )
    .all(kind, partyId) as LedgerRow[]
}

export interface StockMismatch {
  variantId: number
  cached: number
  fromMovements: number
}

/** Proves the stock cache agrees with the movement history. Must always return []. */
export function stockReconcile(db: DB): StockMismatch[] {
  return db
    .prepare(
      `SELECT l.variant_id AS variantId, l.qty AS cached, COALESCE(m.q, 0) AS fromMovements
       FROM stock_levels l
       LEFT JOIN (SELECT variant_id, warehouse_id, SUM(qty_delta) AS q FROM stock_movements GROUP BY variant_id, warehouse_id) m
         ON m.variant_id = l.variant_id AND m.warehouse_id = l.warehouse_id
       WHERE l.qty <> COALESCE(m.q, 0)`,
    )
    .all() as StockMismatch[]
}

export interface ProfitSummary {
  sales: number
  netSales: number
  cogs: number
  grossProfit: number
  expenses: number
  netProfit: number
}

/**
 * Net sales = completed sales. COGS from the cost snapshot on each sale line.
 * Receipts (recovery), supplier payments and transfers are deliberately NOT part of profit.
 * `from` inclusive, `to` exclusive, ISO timestamps.
 */
export function profitSummary(db: DB, from: string, to: string): ProfitSummary {
  const s = db.prepare("SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status='completed' AND ts >= ? AND ts < ?").get(from, to) as { v: number }
  const c = db
    .prepare(
      `SELECT COALESCE(SUM(l.qty * l.unit_cost),0) AS v FROM sale_lines l JOIN sales s ON s.id = l.sale_id
       WHERE s.status='completed' AND s.ts >= ? AND s.ts < ?`,
    )
    .get(from, to) as { v: number }
  const e = db.prepare("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE ts >= ? AND ts < ?").get(from, to) as { v: number }
  const gross = s.v - c.v
  return { sales: s.v, netSales: s.v, cogs: c.v, grossProfit: gross, expenses: e.v, netProfit: gross - e.v }
}
