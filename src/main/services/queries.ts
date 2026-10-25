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
  /** Money that came in as "Other income" (not capital or loans). */
  otherIncome: number
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
  const otherIncome = one("SELECT COALESCE(SUM(amount),0) AS v FROM funds WHERE kind = 'income' AND ts >= ? AND ts < ?")
  const netSales = sales - returns
  const cogs = sold - back
  const gross = netSales - cogs
  return { sales, returns, netSales, cogs, grossProfit: gross, expenses, writeOffs, priceDifferences, otherIncome, netProfit: gross - expenses - writeOffs + priceDifferences + otherIncome }
}

export interface BalanceSpan {
  balanceBefore: number
  balanceAfter: number
}

/**
 * The party's balance just before and just after each of the given documents, read from the ledger
 * (so a reprint months later shows what the bill showed on the day). Positive = the party owes us
 * (customer) or we owe them (supplier).
 *
 * Entries are ordered exactly like the party statement (date, then entry number), so a bill and the
 * statement always agree, even for backdated entries. Each party's ledger is read once with a running
 * total, so the cost grows with the number of parties shown, not with parties x documents.
 */
export function balancesAround(db: DB, kind: "customer" | "supplier", docs: { partyId: number; sourceType: string; sourceId: number }[]): Map<string, BalanceSpan> {
  const out = new Map<string, BalanceSpan>()
  const wanted = new Map<number, Set<string>>()
  for (const d of docs) {
    const set = wanted.get(d.partyId) ?? new Set<string>()
    set.add(`${d.sourceType}:${d.sourceId}`)
    wanted.set(d.partyId, set)
  }
  const sign = kind === "customer" ? "debit - credit" : "credit - debit"
  const stmt = db.prepare(
    `SELECT source_type, source_id, kind, (${sign}) AS delta, SUM(${sign}) OVER (ORDER BY ts, id ROWS UNBOUNDED PRECEDING) AS run
     FROM ledger_entries WHERE party_kind = ? AND party_id = ? ORDER BY ts, id`,
  )
  for (const [partyId, keys] of wanted) {
    const first = new Map<string, number>()
    const last = new Map<string, number>()
    for (const e of stmt.iterate(kind, partyId) as Iterable<{ source_type: string | null; source_id: number | null; kind: string; delta: number; run: number }>) {
      if (e.source_type === null || e.source_id === null || e.kind === "sale_void" || e.kind === "purchase_void") continue
      const key = `${e.source_type}:${e.source_id}`
      if (!keys.has(key)) continue
      if (!first.has(key)) first.set(key, e.run - e.delta)
      last.set(key, e.run)
    }
    for (const [key, before] of first) out.set(key, { balanceBefore: before / 100, balanceAfter: last.get(key)! / 100 })
  }
  return out
}
