import type { DB } from "../db/connection"
import { AppError } from "@core/errors"
import { getSetting } from "../db/util"
import type { ReportResult } from "@shared/models"
import { dayRange } from "./closing"
import { profitSummary } from "./queries"
import { bizDate, docLabel } from "./snapshot"

const r = (minor: number) => minor / 100
type Row = Record<string, string | number>
type Col = ReportResult["columns"][number]
const money = (key: string, label: string): Col => ({ key, label, kind: "money" })
const num = (key: string, label: string): Col => ({ key, label, kind: "number" })
const text = (key: string, label: string): Col => ({ key, label }) as Col
const DAY = 86_400_000

export interface ReportRequest {
  name: string
  from: string
  to: string
  /** Optional narrowing: a party/supplier/company/city/account name. */
  filter?: string
}

function result(columns: Col[], rows: Row[], summary: { label: string; value: number | string; kind?: "money" | "number" | "text"; tone?: string }[], note?: string): ReportResult {
  return { columns, rows, summary: summary.map((s) => ({ ...s, kind: s.kind ?? (typeof s.value === "number" ? "money" : "text") })), note }
}

/** Every report is computed from the transaction tables for the chosen business dates. */
export function runReport(db: DB, q: ReportRequest): ReportResult {
  return noNegativeZero(runReportRaw(db, q))
}

/** A report must never show "-0": adding up a refund and its reversal can leave a negative zero behind. */
function noNegativeZero<T>(v: T): T {
  if (typeof v === "number") return (Object.is(v, -0) ? 0 : v) as T
  if (Array.isArray(v)) return v.map(noNegativeZero) as T
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, noNegativeZero(x)])) as T
  return v
}

function runReportRaw(db: DB, q: ReportRequest): ReportResult {
  const off = Number(getSetting(db, "timezone_offset_minutes", "300"))
  const from = dayRange(db, q.from).from
  const to = dayRange(db, q.to).to
  const f = q.filter?.trim() || ""
  const all = (sql: string, ...args: unknown[]) => db.prepare(sql).all(...args) as Record<string, any>[]
  const d = (iso: string) => bizDate(iso, off)
  const like = f ? `%${f}%` : "%"

  switch (q.name) {
    case "Daily Sales": {
      const rows = all(`SELECT s.ts, s.invoice_no, p.name party, s.total, s.paid, s.status, u.display_name usr FROM sales s JOIN parties p ON p.id=s.party_id LEFT JOIN users u ON u.id=s.user_id WHERE s.ts>=? AND s.ts<? AND p.name LIKE ? ORDER BY s.ts DESC`, from, to, like)
      const live = rows.filter((x) => x.status === "completed")
      const total = live.reduce((s, x) => s + x.total, 0)
      const paid = live.reduce((s, x) => s + x.paid, 0)
      return result(
        [text("date", "Date"), text("ref", "Invoice"), text("party", "Party"), money("total", "Total"), money("paid", "Paid"), money("remaining", "Remaining"), text("status", "Status")],
        rows.map((x) => ({ date: d(x.ts), ref: x.invoice_no, party: x.party, total: r(x.total), paid: r(x.paid), remaining: r(x.total - x.paid), status: x.status === "void" ? "Cancelled" : "Completed" })),
        [{ label: "Total sales", value: r(total) }, { label: "Total received", value: r(paid) }, { label: "Remaining", value: r(total - paid), tone: "red" }],
      )
    }
    case "Sales by Customer":
      return grouped(all(`SELECT p.name k, COUNT(*) n, SUM(s.total) v, SUM(s.paid) p FROM sales s JOIN parties p ON p.id=s.party_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND p.name LIKE ? GROUP BY p.id ORDER BY v DESC`, from, to, like), "Party", "Sales by customer")
    case "Sales by City":
      return grouped(all(`SELECT COALESCE(c.name,'No city') k, COUNT(*) n, SUM(s.total) v, SUM(s.paid) p FROM sales s JOIN parties p ON p.id=s.party_id LEFT JOIN cities c ON c.id=p.city_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND COALESCE(c.name,'No city') LIKE ? GROUP BY c.id ORDER BY v DESC`, from, to, like), "City", "Sales by city")
    case "Sales by Company":
      return linesGrouped(all(`SELECT co.name k, SUM(l.qty) n, SUM(l.line_total) v FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN variants v ON v.id=l.variant_id JOIN items i ON i.id=v.item_id JOIN companies co ON co.id=i.company_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND co.name LIKE ? GROUP BY co.id ORDER BY v DESC`, from, to, like), "Company", "sale")
    case "Sales by Article":
      return linesGrouped(all(`SELECT i.name || COALESCE(' ' || v.color,'') k, SUM(l.qty) n, SUM(l.line_total) v FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN variants v ON v.id=l.variant_id JOIN items i ON i.id=v.item_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND i.name LIKE ? GROUP BY v.id ORDER BY v DESC`, from, to, like), "Article", "sale")
    case "Sales by User":
      return grouped(all(`SELECT COALESCE(u.display_name,'System') k, COUNT(*) n, SUM(s.total) v, SUM(s.paid) p FROM sales s LEFT JOIN users u ON u.id=s.user_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND COALESCE(u.display_name,'System') LIKE ? GROUP BY s.user_id ORDER BY v DESC`, from, to, like), "User", "Sales by user")

    case "Purchase Report": {
      const rows = all(`SELECT s.ts, s.purchase_no, s.supplier_invoice_no sinv, p.name party, s.total, s.paid, s.status FROM purchases s JOIN suppliers p ON p.id=s.supplier_id WHERE s.ts>=? AND s.ts<? AND p.name LIKE ? ORDER BY s.ts DESC`, from, to, like)
      const live = rows.filter((x) => x.status === "completed")
      const total = live.reduce((s, x) => s + x.total, 0)
      const paid = live.reduce((s, x) => s + x.paid, 0)
      return result(
        [text("date", "Date"), text("ref", "Purchase"), text("sinv", "Supplier invoice"), text("party", "Supplier"), money("total", "Total"), money("paid", "Paid"), money("remaining", "Remaining"), text("status", "Status")],
        rows.map((x) => ({ date: d(x.ts), ref: x.purchase_no, sinv: x.sinv ?? "", party: x.party, total: r(x.total), paid: r(x.paid), remaining: r(x.total - x.paid), status: x.status === "void" ? "Cancelled" : "Completed" })),
        [{ label: "Total purchases", value: r(total) }, { label: "Total paid", value: r(paid) }, { label: "Remaining payable", value: r(total - paid), tone: "red" }],
      )
    }
    case "Supplier Purchase":
      return grouped(all(`SELECT p.name k, COUNT(*) n, SUM(s.total) v, SUM(s.paid) p FROM purchases s JOIN suppliers p ON p.id=s.supplier_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND p.name LIKE ? GROUP BY p.id ORDER BY v DESC`, from, to, like), "Supplier", "Purchases by supplier")
    case "Company Purchase":
      return linesGrouped(all(`SELECT co.name k, SUM(l.qty) n, SUM(l.line_total) v FROM purchase_lines l JOIN purchases s ON s.id=l.purchase_id JOIN variants v ON v.id=l.variant_id JOIN items i ON i.id=v.item_id JOIN companies co ON co.id=i.company_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND co.name LIKE ? GROUP BY co.id ORDER BY v DESC`, from, to, like), "Company", "purchase")
    case "Article Purchase":
      return linesGrouped(all(`SELECT i.name || COALESCE(' ' || v.color,'') k, SUM(l.qty) n, SUM(l.line_total) v FROM purchase_lines l JOIN purchases s ON s.id=l.purchase_id JOIN variants v ON v.id=l.variant_id JOIN items i ON i.id=v.item_id WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND i.name LIKE ? GROUP BY v.id ORDER BY v DESC`, from, to, like), "Article", "purchase")

    case "Current Stock":
    case "Stock Valuation":
    case "Low Stock":
    case "Out of Stock": {
      const rows = all(`SELECT i.name article, COALESCE(v.color,'') color, COALESCE(v.size_label,'') size, co.name company, COALESCE(sl.qty,0) qty, COALESCE(sl.avg_cost,0) cost, v.min_stock mn FROM variants v JOIN items i ON i.id=v.item_id JOIN companies co ON co.id=i.company_id LEFT JOIN stock_levels sl ON sl.variant_id=v.id WHERE v.active=1 AND co.name LIKE ? ORDER BY co.name, i.name, v.color`, like)
        .filter((x) => (q.name === "Low Stock" ? x.qty > 0 && x.qty <= x.mn : q.name === "Out of Stock" ? x.qty <= 0 : true))
      const value = rows.reduce((s, x) => s + Math.max(0, x.qty) * x.cost, 0)
      return result(
        [text("company", "Company"), text("article", "Article"), text("color", "Variant"), text("size", "Size"), num("qty", "In stock"), money("cost", "Average cost"), money("value", "Stock value")],
        rows.map((x) => ({ company: x.company, article: x.article, color: x.color, size: x.size, qty: x.qty, cost: r(x.cost), value: r(Math.max(0, x.qty) * x.cost) })),
        [{ label: "Stock value", value: r(value) }, { label: "Items listed", value: rows.length, kind: "number" }, { label: "Units in stock", value: rows.reduce((s, x) => s + Math.max(0, x.qty), 0), kind: "number" }],
      )
    }
    case "Stock Movement": {
      const rows = all(`SELECT m.ts, m.type, m.qty_delta, m.unit_cost, m.source_type, m.source_id, m.note, i.name || COALESCE(' ' || v.color,'') product FROM stock_movements m JOIN variants v ON v.id=m.variant_id JOIN items i ON i.id=v.item_id WHERE m.ts>=? AND m.ts<? AND i.name LIKE ? ORDER BY m.ts DESC, m.id DESC LIMIT 5000`, from, to, like)
      return result(
        [text("date", "Date"), text("ref", "Reference"), text("product", "Product"), text("type", "Type"), num("qty", "Quantity"), text("note", "Note")],
        rows.map((x) => ({ date: d(x.ts), ref: docLabel(db, x.source_type, x.source_id), product: x.product, type: x.type.replace(/_/g, " "), qty: x.qty_delta, note: x.note ?? "" })),
        [{ label: "Movements", value: rows.length, kind: "number" }, { label: "Units in", value: rows.filter((x) => x.qty_delta > 0).reduce((s, x) => s + x.qty_delta, 0), kind: "number" }, { label: "Units out", value: -rows.filter((x) => x.qty_delta < 0).reduce((s, x) => s + x.qty_delta, 0), kind: "number" }],
      )
    }
    case "Stock Adjustments": {
      const rows = all(`SELECT m.ts, m.qty_delta, m.type, m.note, u.display_name usr, i.name || COALESCE(' ' || v.color,'') product FROM stock_movements m JOIN variants v ON v.id=m.variant_id JOIN items i ON i.id=v.item_id LEFT JOIN users u ON u.id=m.user_id WHERE m.type IN ('adjustment_in','adjustment_out','damage') AND m.ts>=? AND m.ts<? ORDER BY m.ts DESC`, from, to)
      return result(
        [text("date", "Date"), text("product", "Product"), text("type", "Type"), num("qty", "Quantity"), text("note", "Reason"), text("user", "By")],
        rows.map((x) => ({ date: d(x.ts), product: x.product, type: x.type === "damage" ? "Damage" : "Adjustment", qty: x.qty_delta, note: x.note ?? "", user: x.usr ?? "" })),
        [{ label: "Adjustments", value: rows.length, kind: "number" }, { label: "Units added", value: rows.filter((x) => x.qty_delta > 0).reduce((s, x) => s + x.qty_delta, 0), kind: "number" }, { label: "Units removed", value: -rows.filter((x) => x.qty_delta < 0).reduce((s, x) => s + x.qty_delta, 0), kind: "number" }],
      )
    }
    case "Near Expiry":
    case "Expired Items":
    case "Batch Stock": {
      const today = bizDate(new Date().toISOString(), off)
      const warn = Number(getSetting(db, "expiry.warning_days", "30"))
      const limit = new Date(new Date(`${today}T00:00:00Z`).getTime() + warn * DAY).toISOString().slice(0, 10)
      const rows = all(`SELECT i.name || COALESCE(' ' || v.color,'') product, b.batch_no, b.mfg_date, b.expiry_date, SUM(m.qty_delta) qty FROM batches b JOIN variants v ON v.id=b.variant_id JOIN items i ON i.id=v.item_id JOIN stock_movements m ON m.batch_id=b.id GROUP BY b.id HAVING qty > 0 ORDER BY b.expiry_date IS NULL, b.expiry_date`)
        .filter((x) => (q.name === "Near Expiry" ? x.expiry_date && x.expiry_date >= today && x.expiry_date <= limit : q.name === "Expired Items" ? x.expiry_date && x.expiry_date < today : true))
      return result(
        [text("product", "Product"), text("batch", "Batch"), text("mfg", "Manufactured"), text("expiry", "Expiry"), num("qty", "In stock"), text("status", "Status")],
        rows.map((x) => ({ product: x.product, batch: x.batch_no, mfg: x.mfg_date ?? "", expiry: x.expiry_date ?? "", qty: x.qty, status: !x.expiry_date ? "No expiry" : x.expiry_date < today ? "Expired" : x.expiry_date <= limit ? "Expiring soon" : "OK" })),
        [{ label: "Batches listed", value: rows.length, kind: "number" }, { label: "Units", value: rows.reduce((s, x) => s + x.qty, 0), kind: "number" }, { label: "Warning period (days)", value: warn, kind: "number" }],
      )
    }

    case "Outstanding Report":
    case "Party Statements":
    case "Receivable Aging":
    case "Supplier Payables":
    case "Supplier Statements":
    case "Payable Aging": {
      const supplier = q.name.startsWith("Supplier") || q.name === "Payable Aging"
      const rows = all(supplier
        ? `SELECT p.id, p.name, COALESCE(c.name,'') city, COALESCE(p.phone,'') phone, COALESCE(b.balance,0) bal FROM suppliers p LEFT JOIN cities c ON c.id=p.city_id LEFT JOIN v_supplier_balance b ON b.supplier_id=p.id WHERE p.name LIKE ? ORDER BY bal DESC`
        : `SELECT p.id, p.name, COALESCE(c.name,'') city, COALESCE(p.phone,'') phone, COALESCE(b.balance,0) bal FROM parties p LEFT JOIN cities c ON c.id=p.city_id LEFT JOIN v_customer_balance b ON b.party_id=p.id WHERE p.is_walk_in=0 AND p.name LIKE ? ORDER BY bal DESC`, like).filter((x) => x.bal !== 0)
      const total = rows.reduce((s, x) => s + Math.max(0, x.bal), 0)
      return result(
        [text("name", supplier ? "Supplier" : "Party"), text("city", "City"), text("phone", "Phone"), money("balance", supplier ? "Payable" : "Outstanding")],
        rows.map((x) => ({ name: x.name, city: x.city, phone: x.phone, balance: r(x.bal) })),
        [{ label: supplier ? "Total payable" : "Total outstanding", value: r(total), tone: "red" }, { label: "Accounts with a balance", value: rows.filter((x) => x.bal > 0).length, kind: "number" }, { label: "Accounts listed", value: rows.length, kind: "number" }],
        q.name.includes("Aging") ? "Open a party and use its Aging tab for the age of each balance." : q.name.includes("Statements") ? "Open a party to see its full statement and print it." : undefined,
      )
    }
    case "Party Payments":
    case "Supplier Payments": {
      const kind = q.name === "Party Payments" ? "customer_receipt" : "supplier_payment"
      const tbl = kind === "customer_receipt" ? "parties" : "suppliers"
      const rows = all(`SELECT y.ts, y.doc_no, p.name party, y.method, a.name account, y.amount, y.received_by, u.display_name usr FROM payments y JOIN ${tbl} p ON p.id=y.party_id JOIN accounts a ON a.id=y.account_id LEFT JOIN users u ON u.id=y.user_id WHERE y.kind=? AND y.status='posted' AND y.ts>=? AND y.ts<? AND p.name LIKE ? ORDER BY y.ts DESC`, kind, from, to, like)
      return result(
        [text("date", "Date"), text("ref", "Receipt"), text("party", kind === "customer_receipt" ? "Party" : "Supplier"), text("method", "Method"), text("account", "Account"), text("user", "By"), money("amount", "Amount")],
        rows.map((x) => ({ date: d(x.ts), ref: x.doc_no, party: x.party, method: x.method, account: x.account, user: x.received_by || x.usr || "", amount: r(x.amount) })),
        [{ label: "Total", value: r(rows.reduce((s, x) => s + x.amount, 0)) }, { label: "Payments", value: rows.length, kind: "number" }, { label: "Average", value: rows.length ? r(Math.round(rows.reduce((s, x) => s + x.amount, 0) / rows.length)) : 0 }],
      )
    }
    case "City-wise Analysis": {
      const rows = all(`SELECT COALESCE(c.name,'No city') city, COUNT(DISTINCT p.id) parties,
          COALESCE((SELECT SUM(s.total) FROM sales s JOIN parties p2 ON p2.id=s.party_id WHERE COALESCE(p2.city_id,0)=COALESCE(c.id,0) AND s.status='completed' AND s.ts>=? AND s.ts<?),0) sales,
          COALESCE((SELECT SUM(y.amount) FROM payments y JOIN parties p3 ON p3.id=y.party_id WHERE y.kind='customer_receipt' AND COALESCE(p3.city_id,0)=COALESCE(c.id,0) AND y.ts>=? AND y.ts<?),0) recovery,
          COALESCE((SELECT SUM(CASE WHEN b.balance>0 THEN b.balance ELSE 0 END) FROM v_customer_balance b JOIN parties p4 ON p4.id=b.party_id WHERE COALESCE(p4.city_id,0)=COALESCE(c.id,0)),0) outstanding
        FROM parties p LEFT JOIN cities c ON c.id=p.city_id WHERE p.is_walk_in=0 AND COALESCE(c.name,'No city') LIKE ? GROUP BY c.id ORDER BY outstanding DESC`, from, to, from, to, like)
      return result(
        [text("city", "City"), num("parties", "Parties"), money("sales", "Sales"), money("recovery", "Recovery"), money("outstanding", "Outstanding")],
        rows.map((x) => ({ city: x.city, parties: x.parties, sales: r(x.sales), recovery: r(x.recovery), outstanding: r(x.outstanding) })),
        [{ label: "Sales", value: r(rows.reduce((s, x) => s + x.sales, 0)) }, { label: "Recovery", value: r(rows.reduce((s, x) => s + x.recovery, 0)) }, { label: "Outstanding", value: r(rows.reduce((s, x) => s + x.outstanding, 0)), tone: "red" }],
        "Open a party from the Customers page to continue from city to party to ledger.",
      )
    }

    case "Cash Book":
    case "Bank Book": {
      const type = q.name === "Cash Book" ? "cash" : "bank"
      const accs = all("SELECT id, name FROM accounts WHERE type = ? AND name LIKE ? ORDER BY id", type, like)
      const rows: Row[] = []
      let opening = 0
      let inn = 0
      let out = 0
      for (const a of accs) {
        let bal = (db.prepare("SELECT COALESCE(SUM(amount),0) b FROM account_entries WHERE account_id=? AND ts<?").get(a.id, from) as { b: number }).b
        opening += bal
        rows.push({ date: q.from, ref: "", account: a.name, description: "Opening balance", incoming: 0, outgoing: 0, balance: r(bal) })
        for (const e of all("SELECT ts, amount, kind, description, source_type, source_id FROM account_entries WHERE account_id=? AND ts>=? AND ts<? ORDER BY ts, id", a.id, from, to)) {
          bal += e.amount
          if (e.amount > 0) inn += e.amount
          else out -= e.amount
          rows.push({ date: d(e.ts), ref: docLabel(db, e.source_type, e.source_id), account: a.name, description: e.description ?? e.kind, incoming: e.amount > 0 ? r(e.amount) : 0, outgoing: e.amount < 0 ? r(-e.amount) : 0, balance: r(bal) })
        }
      }
      return result(
        [text("date", "Date"), text("ref", "Reference"), text("account", "Account"), text("description", "Description"), money("incoming", "In"), money("outgoing", "Out"), money("balance", "Balance")],
        rows,
        [{ label: "Opening", value: r(opening) }, { label: "Money in", value: r(inn), tone: "green" }, { label: "Money out", value: r(out), tone: "red" }],
      )
    }
    case "Transfers": {
      const rows = all(`SELECT t.ts, t.id, a.name fa, b.name ta, t.amount, t.note FROM account_transfers t JOIN accounts a ON a.id=t.from_account_id JOIN accounts b ON b.id=t.to_account_id WHERE t.ts>=? AND t.ts<? ORDER BY t.ts DESC`, from, to)
      return result(
        [text("date", "Date"), text("from", "From"), text("to", "To"), text("note", "Note"), money("amount", "Amount")],
        rows.map((x) => ({ date: d(x.ts), from: x.fa, to: x.ta, note: x.note ?? "", amount: r(x.amount) })),
        [{ label: "Transferred", value: r(rows.reduce((s, x) => s + x.amount, 0)) }, { label: "Transfers", value: rows.length, kind: "number" }, { label: "Counted as income or expense", value: "No", kind: "text" }],
      )
    }
    case "Expenses": {
      const rows = all(`SELECT e.ts, c.name category, a.name account, e.amount, e.description FROM expenses e JOIN expense_categories c ON c.id=e.category_id JOIN accounts a ON a.id=e.account_id WHERE e.ts>=? AND e.ts<? AND c.name LIKE ? ORDER BY e.ts DESC`, from, to, like)
      const top = Object.entries(rows.reduce((m: Record<string, number>, x) => ((m[x.category] = (m[x.category] ?? 0) + x.amount), m), {})).sort((a, b) => b[1] - a[1])[0]
      return result(
        [text("date", "Date"), text("category", "Category"), text("note", "Notes"), text("account", "Account"), money("amount", "Amount")],
        rows.map((x) => ({ date: d(x.ts), category: x.category, note: x.description ?? "", account: x.account, amount: r(x.amount) })),
        [{ label: "Total expenses", value: r(rows.reduce((s, x) => s + x.amount, 0)), tone: "red" }, { label: "Entries", value: rows.length, kind: "number" }, { label: "Largest category", value: top ? top[0] : "—", kind: "text" }],
      )
    }
    case "Daily Closing": {
      const rows = all(`SELECT c.business_date, a.name account, c.expected, c.counted, c.variance, c.notes, u.display_name usr FROM cash_closings c JOIN accounts a ON a.id=c.account_id LEFT JOIN users u ON u.id=c.user_id WHERE c.business_date>=? AND c.business_date<=? ORDER BY c.business_date DESC`, q.from, q.to)
      return result(
        [text("date", "Date"), text("account", "Account"), money("expected", "Recorded"), money("counted", "Counted"), money("variance", "Difference"), text("note", "Notes"), text("user", "By")],
        rows.map((x) => ({ date: x.business_date, account: x.account, expected: r(x.expected), counted: r(x.counted), variance: r(x.variance), note: x.notes ?? "", user: x.usr ?? "" })),
        [{ label: "Closings", value: rows.length, kind: "number" }, { label: "Net difference", value: r(rows.reduce((s, x) => s + x.variance, 0)), tone: "red" }, { label: "Days with a difference", value: rows.filter((x) => x.variance !== 0).length, kind: "number" }],
      )
    }

    case "Profit & Loss": {
      const p = profitSummary(db, from, to)
      const rows: Row[] = [
        { name: "Sales", amount: r(p.sales) },
        { name: "Less: sale returns", amount: -r(p.returns) },
        { name: "Net sales", amount: r(p.netSales) },
        { name: "Cost of goods sold", amount: -r(p.cogs) },
        { name: "Gross profit", amount: r(p.grossProfit) },
        { name: "Operating expenses", amount: -r(p.expenses) },
        { name: "Stock write-offs (damage, shrinkage, count differences)", amount: -r(p.writeOffs) },
        { name: "Purchase price differences on returns / cancellations", amount: r(p.priceDifferences) },
        { name: "Net profit", amount: r(p.netProfit) },
      ]
      return result([text("name", "Particulars"), money("amount", "Amount (PKR)")], rows, [{ label: "Net sales", value: r(p.netSales) }, { label: "Gross profit", value: r(p.grossProfit), tone: "green" }, { label: "Net profit", value: r(p.netProfit), tone: p.netProfit >= 0 ? "green" : "red" }], "Cost of goods sold uses the weighted-average cost recorded at the time of each sale. Transfers, recoveries and supplier payments are not part of profit.")
    }
    case "Daily Profit":
    case "Monthly Profit": {
      const monthly = q.name === "Monthly Profit"
      const days: Row[] = []
      let cur = q.from
      const end = q.to
      let guard = 0
      while (cur <= end && guard++ < 800) {
        const next = monthly ? new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 1)).toISOString().slice(0, 10) : new Date(new Date(`${cur}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10)
        const stop = next > end ? new Date(new Date(`${end}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10) : next
        const p = profitSummary(db, dayRange(db, cur).from, dayRange(db, stop === next ? new Date(new Date(`${next}T00:00:00Z`).getTime() - DAY).toISOString().slice(0, 10) : end).to)
        days.push({ period: monthly ? cur.slice(0, 7) : cur, sales: r(p.netSales), cogs: r(p.cogs), gross: r(p.grossProfit), expenses: r(p.expenses + p.writeOffs - p.priceDifferences), net: r(p.netProfit) })
        cur = next
      }
      const sum = (k: string) => days.reduce((s, x) => s + (x[k] as number), 0)
      return result([text("period", monthly ? "Month" : "Date"), money("sales", "Net sales"), money("cogs", "Cost of goods"), money("gross", "Gross profit"), money("expenses", "Expenses & losses"), money("net", "Net profit")], days, [{ label: "Net sales", value: sum("sales") }, { label: "Gross profit", value: sum("gross"), tone: "green" }, { label: "Net profit", value: sum("net"), tone: sum("net") >= 0 ? "green" : "red" }])
    }
    case "Company Profitability":
    case "Category Profitability":
    case "Customer Profitability":
    case "City Profitability": {
      const key = q.name === "Company Profitability" ? "co.name" : q.name === "Category Profitability" ? "COALESCE(cat.name,'No category')" : q.name === "Customer Profitability" ? "p.name" : "COALESCE(ci.name,'No city')"
      const label = q.name.replace(" Profitability", "")
      const rows = all(`SELECT ${key} k, SUM(l.line_total) sales, SUM(l.cost_total) cogs
        FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN parties p ON p.id=s.party_id LEFT JOIN cities ci ON ci.id=p.city_id
        JOIN variants v ON v.id=l.variant_id JOIN items i ON i.id=v.item_id JOIN companies co ON co.id=i.company_id LEFT JOIN categories cat ON cat.id=i.category_id
        WHERE s.status='completed' AND s.ts>=? AND s.ts<? AND ${key} LIKE ? GROUP BY ${key} ORDER BY (SUM(l.line_total)-SUM(l.cost_total)) DESC`, from, to, like)
      return result(
        [text("name", label), money("sales", "Sales"), money("cogs", "Cost of goods"), money("profit", "Gross profit"), { key: "margin", label: "Margin %", kind: "number" }],
        rows.map((x) => ({ name: x.k, sales: r(x.sales), cogs: r(x.cogs), profit: r(x.sales - x.cogs), margin: x.sales > 0 ? Math.round(((x.sales - x.cogs) / x.sales) * 1000) / 10 : 0 })),
        [{ label: "Sales", value: r(rows.reduce((s, x) => s + x.sales, 0)) }, { label: "Gross profit", value: r(rows.reduce((s, x) => s + x.sales - x.cogs, 0)), tone: "green" }, { label: `${label} groups`, value: rows.length, kind: "number" }],
        "Before returns and operating expenses. Use Profit & Loss for the final figure.",
      )
    }
    default:
      throw new AppError("NOT_FOUND", `Unknown report: ${q.name}`)
  }

  function grouped(rows: Record<string, any>[], label: string, _title: string): ReportResult {
    const total = rows.reduce((s, x) => s + x.v, 0)
    const paid = rows.reduce((s, x) => s + x.p, 0)
    return result(
      [text("name", label), num("n", "Invoices"), money("total", "Sales"), money("paid", "Received"), money("remaining", "Remaining")],
      rows.map((x) => ({ name: x.k, n: x.n, total: r(x.v), paid: r(x.p), remaining: r(x.v - x.p) })),
      [{ label: "Total sales", value: r(total) }, { label: "Total received", value: r(paid) }, { label: "Remaining", value: r(total - paid), tone: "red" }],
    )
  }
  function linesGrouped(rows: Record<string, any>[], label: string, kind: "sale" | "purchase"): ReportResult {
    const items = rows.reduce((s, x) => s + x.v, 0)
    const summary: Parameters<typeof result>[2] = [{ label: "Total amount", value: r(items) }, { label: "Units", value: rows.reduce((s, x) => s + x.n, 0), kind: "number" }, { label: "Groups", value: rows.length, kind: "number" }]
    // A discount given on the whole invoice belongs to no single item, so item amounts are shown before it.
    // Without a filter the report can show it, so its net figure equals the invoice totals of the same days.
    let note = "Item amounts are before any discount given on the whole invoice."
    if (!f) {
      const t = kind === "sale" ? "sales" : "purchases"
      const l = kind === "sale" ? "sale_lines" : "purchase_lines"
      const fk = kind === "sale" ? "sale_id" : "purchase_id"
      const whole = (db.prepare(`SELECT COALESCE(SUM(s.discount),0) - COALESCE((SELECT SUM(l.discount) FROM ${l} l JOIN ${t} s2 ON s2.id = l.${fk} WHERE s2.status='completed' AND s2.ts>=? AND s2.ts<?),0) AS v FROM ${t} s WHERE s.status='completed' AND s.ts>=? AND s.ts<?`).get(from, to, from, to) as { v: number }).v
      if (whole > 0) {
        summary.splice(1, 0, { label: "Whole-invoice discounts", value: -r(whole) }, { label: "Net amount (matches invoice totals)", value: r(items - whole) })
        note = "Item amounts are before discounts given on the whole invoice; those are shown separately so the net amount equals the invoice totals."
      }
    }
    return result([text("name", label), num("n", "Units"), money("total", "Amount")], rows.map((x) => ({ name: x.k, n: x.n, total: r(x.v) })), summary, note)
  }
}
