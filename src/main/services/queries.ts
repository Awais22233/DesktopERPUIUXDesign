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
  cachedValue: number
  valueFromMovements: number
}

/** Proves the stock cache (quantity and value) agrees with the movement history. Must always return []. */
export function stockReconcile(db: DB): StockMismatch[] {
  return db
    .prepare(
      `SELECT l.variant_id AS variantId, l.qty AS cached, COALESCE(m.q, 0) AS fromMovements,
              l.value AS cachedValue, COALESCE(m.v, 0) AS valueFromMovements
       FROM stock_levels l
       LEFT JOIN (SELECT variant_id, warehouse_id, SUM(qty_delta) AS q, SUM(value) AS v FROM stock_movements GROUP BY variant_id, warehouse_id) m
         ON m.variant_id = l.variant_id AND m.warehouse_id = l.warehouse_id
       WHERE l.qty <> COALESCE(m.q, 0) OR l.value <> COALESCE(m.v, 0)`,
    )
    .all() as StockMismatch[]
}

export interface ProfitSummary {
  sales: number
  returns: number
  netSales: number
  cogs: number
  grossProfit: number
  expenses: number
  /** Stock lost to damage, shrinkage and count differences (net of gains). */
  writeOffs: number
  /** Supplier credit received on purchase returns / cancellations minus the stock value that left. */
  priceDifferences: number
  netProfit: number
}

/**
 * Net sales = completed sales minus sale returns. COGS = exact cost of goods sold minus the exact cost of
 * goods that came back in sellable condition (a damaged return keeps its cost as a loss).
 * Receipts (recovery), supplier payments and transfers are deliberately NOT part of profit.
 * `from` inclusive, `to` exclusive, ISO timestamps.
 */
export function profitSummary(db: DB, from: string, to: string): ProfitSummary {
  const one = (sql: string) => (db.prepare(sql).get(from, to) as { v: number }).v
  const sales = one("SELECT COALESCE(SUM(total),0) AS v FROM sales WHERE status='completed' AND ts >= ? AND ts < ?")
  const returns = one("SELECT COALESCE(SUM(total),0) AS v FROM sale_returns WHERE ts >= ? AND ts < ?")
  const sold = one(`SELECT COALESCE(SUM(l.cost_total),0) AS v FROM sale_lines l JOIN sales s ON s.id = l.sale_id WHERE s.status='completed' AND s.ts >= ? AND s.ts < ?`)
  const back = one(`SELECT COALESCE(SUM(l.cost_total),0) AS v FROM sale_return_lines l JOIN sale_returns r ON r.id = l.return_id WHERE l.damaged = 0 AND r.ts >= ? AND r.ts < ?`)
  const expenses = one("SELECT COALESCE(SUM(amount),0) AS v FROM expenses WHERE ts >= ? AND ts < ?")
  // A damaged sale return is already a loss inside COGS, so only other write-offs count here.
  const writeOffs = -one(
    `SELECT COALESCE(SUM(value),0) AS v FROM stock_movements
     WHERE type IN ('damage','adjustment_in','adjustment_out') AND COALESCE(source_type,'') <> 'sale_return' AND ts >= ? AND ts < ?`,
  )
  const credited =
    one("SELECT COALESCE(SUM(total),0) AS v FROM purchase_returns WHERE ts >= ? AND ts < ?") +
    one("SELECT COALESCE(SUM(total),0) AS v FROM purchases WHERE status='void' AND voided_at >= ? AND voided_at < ?")
  const removed = -one("SELECT COALESCE(SUM(value),0) AS v FROM stock_movements WHERE type IN ('purchase_return','purchase_void') AND ts >= ? AND ts < ?")
  const priceDifferences = credited - removed
  const netSales = sales - returns
  const cogs = sold - back
  const gross = netSales - cogs
  return { sales, returns, netSales, cogs, grossProfit: gross, expenses, writeOffs, priceDifferences, netProfit: gross - expenses - writeOffs + priceDifferences }
}
