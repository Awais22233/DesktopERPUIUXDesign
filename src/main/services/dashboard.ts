import type { DB } from "../db/connection"
import { getSetting } from "../db/util"
import type { DashboardData } from "@shared/models"
import { dayRange } from "./closing"
import { profitSummary } from "./queries"
import { bizDate } from "./snapshot"

const r = (minor: number) => minor / 100
const DAY = 86_400_000
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10)
}
const dayLabel = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`)
  return `${WEEKDAYS[t.getUTCDay()]}, ${t.getUTCDate()}`
}
const bucketLabel = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`)
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]}`
}

export function buildDashboard(db: DB, today: string): DashboardData {
  const off = Number(getSetting(db, "timezone_offset_minutes", "300"))
  const { from, to } = dayRange(db, today)
  const one = (sql: string, ...args: unknown[]) => (db.prepare(sql).get(...args) as { v: number }).v

  const todayProfit = profitSummary(db, from, to)
  const todaySalesCount = one("SELECT COUNT(*) v FROM sales WHERE status='completed' AND ts >= ? AND ts < ?", from, to)
  const todayRecovery = one("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE kind='customer_receipt' AND status='posted' AND ts >= ? AND ts < ?", from, to)
  const todayRecoveryCount = one("SELECT COUNT(*) v FROM payments WHERE kind='customer_receipt' AND status='posted' AND ts >= ? AND ts < ?", from, to)
  const todayPurchases = one("SELECT COALESCE(SUM(total),0) v FROM purchases WHERE status='completed' AND ts >= ? AND ts < ?", from, to)
  const todayPurchaseCount = one("SELECT COUNT(*) v FROM purchases WHERE status='completed' AND ts >= ? AND ts < ?", from, to)

  const received = db
    .prepare(
      `SELECT a.type, COALESCE(SUM(e.amount),0) AS v FROM account_entries e JOIN accounts a ON a.id = e.account_id
       WHERE e.kind IN ('sale_receipt','customer_receipt') AND e.ts >= ? AND e.ts < ? GROUP BY a.type`,
    )
    .all(from, to) as { type: string; v: number }[]
  const receivedCash = received.find((x) => x.type === "cash")?.v ?? 0
  const receivedBank = received.find((x) => x.type === "bank")?.v ?? 0
  const salesReceived = one(`SELECT COALESCE(SUM(amount),0) v FROM account_entries WHERE kind='sale_receipt' AND ts >= ? AND ts < ?`, from, to)

  // ---- sales series (net of returns), by business day ----
  const since = new Date(Date.now() - 70 * DAY).toISOString()
  const perDay = new Map<string, number>()
  const add = (iso: string, v: number) => {
    const d = bizDate(iso, off)
    perDay.set(d, (perDay.get(d) ?? 0) + v)
  }
  for (const x of db.prepare("SELECT ts, total FROM sales WHERE status='completed' AND ts >= ?").all(since) as { ts: string; total: number }[]) add(x.ts, x.total)
  for (const x of db.prepare("SELECT ts, total FROM sale_returns WHERE ts >= ?").all(since) as { ts: string; total: number }[]) add(x.ts, -x.total)
  const sum = (a: string, b: string) => { // inclusive range of dates
    let t = 0
    for (let d = a; d <= b; d = addDays(d, 1)) t += perDay.get(d) ?? 0
    return t
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(today, i - 6)
    return { label: dayLabel(d), value: r(perDay.get(d) ?? 0) }
  })
  const weekPrev = r(sum(addDays(today, -13), addDays(today, -7)))
  const month = Array.from({ length: 7 }, (_, i) => {
    const end = addDays(today, -(6 - i) * 4)
    return { label: bucketLabel(end), value: r(sum(addDays(end, -3), end)) }
  })
  const monthPrev = r(sum(addDays(today, -55), addDays(today, -28)))

  // ---- expiry alerts ----
  const warn = Number(getSetting(db, "expiry.warning_days", "30"))
  const limit = addDays(today, warn)
  const expiring = (db
    .prepare(
      `SELECT i.name || COALESCE(' ' || v.color, '') AS product, b.batch_no AS batch, b.expiry_date AS expiry, SUM(m.qty_delta) AS qty
       FROM batches b JOIN variants v ON v.id = b.variant_id JOIN items i ON i.id = v.item_id JOIN stock_movements m ON m.batch_id = b.id
       WHERE b.expiry_date IS NOT NULL AND b.expiry_date <= ? GROUP BY b.id HAVING qty > 0 ORDER BY b.expiry_date LIMIT 12`,
    )
    .all(limit) as { product: string; batch: string; expiry: string; qty: number }[]).map((x) => ({
    ...x,
    days: Math.round((new Date(`${x.expiry}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY),
  }))

  // ---- cities ----
  const since30 = new Date(Date.now() - 30 * DAY).toISOString()
  const cities = (db
    .prepare(
      `SELECT c.name AS city,
              (SELECT COUNT(*) FROM parties p WHERE p.city_id = c.id AND p.is_walk_in = 0) AS parties,
              COALESCE((SELECT SUM(s.total) FROM sales s JOIN parties p ON p.id = s.party_id WHERE p.city_id = c.id AND s.status='completed' AND s.ts >= ?),0) AS sales,
              COALESCE((SELECT SUM(py.amount) FROM payments py JOIN parties p ON p.id = py.party_id WHERE py.kind='customer_receipt' AND p.city_id = c.id AND py.ts >= ?),0) AS recovery,
              COALESCE((SELECT SUM(CASE WHEN b.balance > 0 THEN b.balance ELSE 0 END) FROM v_customer_balance b JOIN parties p ON p.id = b.party_id WHERE p.city_id = c.id),0) AS outstanding
       FROM cities c ORDER BY outstanding DESC, sales DESC LIMIT 8`,
    )
    .all(since30, since30) as { city: string; parties: number; sales: number; recovery: number; outstanding: number }[])
    .filter((c) => c.parties > 0)
    .map((c) => ({ city: c.city, parties: c.parties, sales: r(c.sales), recovery: r(c.recovery), outstanding: r(c.outstanding) }))

  return {
    todaySales: r(todayProfit.netSales),
    todaySalesCount,
    todayRecovery: r(todayRecovery),
    todayRecoveryCount,
    todayPurchases: r(todayPurchases),
    todayPurchaseCount,
    todayExpenses: r(todayProfit.expenses),
    grossProfit: r(todayProfit.grossProfit),
    margin: todayProfit.netSales > 0 ? Math.round((todayProfit.grossProfit / todayProfit.netSales) * 1000) / 10 : null,
    receivables: r(one("SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),0) v FROM v_customer_balance")),
    payables: r(one("SELECT COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END),0) v FROM v_supplier_balance")),
    stockValue: r(one("SELECT COALESCE(SUM(value),0) v FROM stock_levels WHERE qty > 0")),
    receivedCash: r(receivedCash),
    receivedBank: r(receivedBank),
    salesReceived: r(salesReceived),
    week,
    weekPrev,
    month,
    monthPrev,
    expiring,
    cities,
  }
}
