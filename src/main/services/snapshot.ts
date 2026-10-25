import { listStaff } from "./staff"
import type { DB } from "../db/connection"
import { getSetting } from "../db/util"
import { buildDashboard } from "./dashboard"
import { balancesAround } from "./queries"
import { SETTING_KEYS, fmtId, type Audit, type CartItem, type Masters, type Snapshot, type Transaction } from "@shared/models"

const r = (minor: number) => minor / 100
/** History shown in lists and reports. Balances, stock and cash are always computed from ALL records. */
const HISTORY_DAYS = 400

function offsetMinutes(db: DB): number {
  return Number(getSetting(db, "timezone_offset_minutes", "300"))
}
const localParts = (iso: string, off: number) => new Date(new Date(iso).getTime() + off * 60_000).toISOString()
export const bizDate = (iso: string, off: number) => localParts(iso, off).slice(0, 10)
export const bizTime = (iso: string, off: number) => localParts(iso, off).slice(11, 16)

const ENTRY_LABEL: Record<string, string> = {
  opening: "Opening",
  sale_receipt: "Sale",
  customer_receipt: "Recovery",
  supplier_payment: "Supplier payment",
  purchase_payment: "Purchase",
  expense: "Expense",
  fund_in: "Money in",
  transfer_in: "Transfer",
  transfer_out: "Transfer",
  void_reversal: "Void",
  refund: "Refund",
  adjustment: "Adjustment",
}

const money = (n: number) => "Rs. " + n.toLocaleString("en-PK", { maximumFractionDigits: 0 })

function auditText(action: string, d: Record<string, unknown>): { action: string; detail: string } {
  const amt = (k: string) => (typeof d[k] === "number" ? money(r(d[k] as number)) : "")
  const join = (...p: (string | undefined)[]) => p.filter(Boolean).join(" · ")
  switch (action) {
    case "sale.create": return { action: "Sale saved", detail: join(String(d.invoiceNo), amt("total")) }
    case "sale.void": return { action: "Sale cancelled", detail: join(String(d.invoiceNo), String(d.reason)) }
    case "purchase.create": return { action: "Purchase saved", detail: join(String(d.purchaseNo), amt("total")) }
    case "purchase.void": return { action: "Purchase cancelled", detail: join(String(d.purchaseNo), String(d.reason)) }
    case "payment.receipt": return { action: "Payment received", detail: join(String(d.docNo), amt("amount")) }
    case "payment.supplier": return { action: "Supplier payment", detail: join(String(d.docNo), amt("amount")) }
    case "expense.create": return { action: "Expense saved", detail: amt("amount") }
    case "transfer.create": return { action: "Account transfer", detail: amt("amount") }
    case "stock.adjust": return { action: "Stock adjusted", detail: join(`${d.qtyDelta} units`, String(d.reason)) }
    case "stock.count": return { action: "Stock count", detail: `${d.lines} items counted, ${d.adjusted} adjusted` }
    case "return.sale": return { action: "Sale return", detail: join(String(d.returnNo), amt("total")) }
    case "return.purchase": return { action: "Purchase return", detail: join(String(d.returnNo), amt("total")) }
    case "exchange": return { action: "Exchange", detail: join(String(d.returnNo), String(d.invoiceNo)) }
    case "cash.close": return { action: "Cash closing", detail: join(String(d.date), `variance ${money(r(Number(d.variance)))}`) }
    case "business.update": return { action: "Business details updated", detail: String(d.name ?? "") }
    case "auth.login": return { action: "Signed in", detail: "" }
    case "auth.logout": return { action: "Signed out", detail: "" }
    case "user.create": return { action: "User added", detail: join(String(d.username), String(d.role)) }
    case "config.flag": return { action: "Feature changed", detail: `${d.enabled ? "on" : "off"}` }
    default: return { action, detail: Object.keys(d).length ? JSON.stringify(d).slice(0, 160) : "" }
  }
}

const docCache = new WeakMap<DB, Map<string, string>>()
/** The document number a stock/ledger/cash entry came from (INV-00001, RCT-00004, ...). */
export function docLabel(db: DB, src: string | null, id: number | null): string {
  if (!src || id == null) return ""
  let cache = docCache.get(db)
  if (!cache) docCache.set(db, (cache = new Map()))
  const key = `${src}:${id}`
  if (cache.has(key)) return cache.get(key)!
  const q: Record<string, string> = {
    sale: "SELECT invoice_no AS n FROM sales WHERE id = ?", purchase: "SELECT purchase_no AS n FROM purchases WHERE id = ?",
    payment: "SELECT doc_no AS n FROM payments WHERE id = ?", sale_return: "SELECT return_no AS n FROM sale_returns WHERE id = ?",
    purchase_return: "SELECT return_no AS n FROM purchase_returns WHERE id = ?",
  }
  let v = src === "expense" ? ((db.prepare("SELECT reference FROM expenses WHERE id = ?").get(id) as { reference: string | null } | undefined)?.reference || fmtId("EXP", id)) : src === "transfer" ? fmtId("TRF", id) : src === "fund" ? fmtId("FND", id) : src === "stock_count" ? fmtId("CNT", id) : src === "adjustment" ? fmtId("ADJ", id) : src === "opening" ? fmtId("OPEN", id) : ""
  if (!v && q[src]) v = ((db.prepare(q[src]).get(id) as { n: string } | undefined)?.n) ?? ""
  cache.set(key, v)
  return v
}

export function buildMasters(db: DB): Masters {
  const settings: Record<string, string> = {}
  for (const k of SETTING_KEYS) {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(k) as { value: string } | undefined
    if (row) settings[k] = row.value
  }
  const json = (key: string, fallback: string[]): string[] => {
    try {
      const v = JSON.parse(getSetting(db, key, ""))
      return Array.isArray(v) ? v.map(String) : fallback
    } catch {
      return fallback
    }
  }
  const tops = db.prepare("SELECT id, name FROM categories WHERE parent_id IS NULL ORDER BY name").all() as { id: number; name: string }[]
  return {
    accounts: (db.prepare(`SELECT a.id, a.name, a.type, a.active, COALESCE(b.balance,0) AS bal FROM accounts a LEFT JOIN v_account_balance b ON b.account_id = a.id ORDER BY a.id`).all() as { id: number; name: string; type: "cash" | "bank"; active: number; bal: number }[]).map((a) => ({ id: a.id, name: a.name, type: a.type, balance: r(a.bal), active: !!a.active })),
    expenseCategories: (db.prepare("SELECT name FROM expense_categories ORDER BY name").all() as { name: string }[]).map((x) => x.name),
    staff: listStaff(db).map((x) => ({ ...x, id: fmtId("STF", x.id) })),
    companies: (db.prepare("SELECT name FROM companies ORDER BY name").all() as { name: string }[]).map((x) => x.name),
    categories: tops.map((t) => ({ name: t.name, sub: (db.prepare("SELECT name FROM categories WHERE parent_id = ? ORDER BY name").all(t.id) as { name: string }[]).map((s) => s.name) })),
    cities: (db.prepare("SELECT name FROM cities ORDER BY name").all() as { name: string }[]).map((x) => x.name),
    thanSizes: json("than.sizes", []),
    paymentMethods: json("payment.methods", ["Cash", "Bank transfer", "Cheque", "Card"]),
    roles: (db.prepare("SELECT id, name, is_system FROM roles ORDER BY id").all() as { id: number; name: string; is_system: number }[]).map((ro) => ({
      name: ro.name,
      system: !!ro.is_system,
      permissions: (db.prepare("SELECT permission FROM role_permissions WHERE role_id = ? ORDER BY permission").all(ro.id) as { permission: string }[]).map((p) => p.permission),
    })),
    sequences: (db.prepare("SELECT kind, prefix, next_number FROM document_sequences ORDER BY kind").all() as { kind: string; prefix: string; next_number: number }[]).map((s) => ({ kind: s.kind, prefix: s.prefix, next: s.next_number })),
    settings,
  }
}

export function buildSnapshot(db: DB): Snapshot {
  const off = offsetMinutes(db)
  const nowIso = new Date().toISOString()
  const today = bizDate(nowIso, off)
  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString()
  const historyFrom = today.slice(0, 8) + "01"
  const walk = db.prepare("SELECT id FROM parties WHERE is_walk_in = 1").get() as { id: number } | undefined

  const partyRow = (x: { id: number; name: string; city: string | null; phone: string | null; whatsapp?: string | null; area?: string | null; address: string | null; notes: string | null; credit_limit?: number; payment_terms_days: number | null; status: string; bal: number; salesman_id?: number | null; recovery_id?: number | null }, prefix: string) => ({
    id: fmtId(prefix, x.id),
    name: x.name,
    city: x.city ?? "",
    phone: x.phone ?? "",
    whatsapp: x.whatsapp ?? "",
    area: x.area ?? "",
    address: x.address ?? "",
    notes: x.notes ?? "",
    terms: x.payment_terms_days ?? undefined,
    salesmanId: x.salesman_id ? fmtId("STF", x.salesman_id) : undefined,
    recoveryId: x.recovery_id ? fmtId("STF", x.recovery_id) : undefined,
    balance: r(x.bal),
    limit: r(x.credit_limit ?? 0),
    status: x.status === "inactive" ? "Inactive" : x.bal > 0 ? "Outstanding" : "Clear",
  })
  const parties = (db.prepare(`SELECT p.*, c.name AS city, COALESCE(b.balance,0) AS bal FROM parties p LEFT JOIN cities c ON c.id = p.city_id LEFT JOIN v_customer_balance b ON b.party_id = p.id WHERE p.is_walk_in = 0 ORDER BY p.name`).all() as never[]).map((x) => partyRow(x, "PTY"))
  const suppliers = (db.prepare(`SELECT s.*, c.name AS city, COALESCE(b.balance,0) AS bal FROM suppliers s LEFT JOIN cities c ON c.id = s.city_id LEFT JOIN v_supplier_balance b ON b.supplier_id = s.id ORDER BY s.name`).all() as never[]).map((x) => partyRow(x, "SUP"))

  const collectionRows = (db.prepare(`SELECT p.id AS pay_id, p.party_id AS party_id, p.doc_no, p.ts, p.amount, p.method, p.reference, p.notes, p.received_by, pa.name AS party, pa.address AS paddr, pa.phone AS pphone, pc.name AS pcity, a.name AS account, u.display_name AS usr
      FROM payments p JOIN parties pa ON pa.id = p.party_id LEFT JOIN cities pc ON pc.id = pa.city_id JOIN accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'customer_receipt' AND p.status = 'posted' AND p.ts >= ? ORDER BY p.ts DESC, p.id DESC LIMIT 3000`).all(since) as Record<string, any>[]).map((x) => ({
    id: x.doc_no, party: x.party, partyAddress: x.paddr ?? undefined, partyPhone: x.pphone ?? undefined, partyCity: x.pcity ?? undefined, amount: r(x.amount), method: x.method, account: x.account, date: bizDate(x.ts, off), time: bizTime(x.ts, off), user: x.received_by || x.usr || "", notes: x.notes ?? "", pay_id: x.pay_id as number, party_id: x.party_id as number,
  }))
  const supplierPayments = (db.prepare(`SELECT p.doc_no, p.ts, p.amount, p.method, p.notes, su.name AS party, a.name AS account, u.display_name AS usr
      FROM payments p JOIN suppliers su ON su.id = p.party_id JOIN accounts a ON a.id = p.account_id LEFT JOIN users u ON u.id = p.user_id
      WHERE p.kind = 'supplier_payment' AND p.status = 'posted' AND p.ts >= ? ORDER BY p.ts DESC, p.id DESC LIMIT 3000`).all(since) as Record<string, any>[]).map((x) => ({
    id: x.doc_no, party: x.party, amount: r(x.amount), method: x.method, account: x.account, date: bizDate(x.ts, off), time: bizTime(x.ts, off), user: x.usr || "", notes: x.notes ?? "", supplier: true,
  }))
  const collectionBalances = balancesAround(db, "customer", collectionRows.map((x) => ({ partyId: x.party_id, sourceType: "payment", sourceId: x.pay_id })))
  const collections = collectionRows.map(({ pay_id, party_id, ...c }) => ({ ...c, ...(collectionBalances.get(`payment:${pay_id}`) ?? {}) }))

  const expenses = (db.prepare(`SELECT e.id, e.reference, e.ts, e.amount, e.description, c.name AS category, a.name AS account, u.display_name AS usr FROM expenses e JOIN expense_categories c ON c.id = e.category_id JOIN accounts a ON a.id = e.account_id LEFT JOIN users u ON u.id = e.user_id WHERE e.ts >= ? ORDER BY e.ts DESC, e.id DESC LIMIT 3000`).all(since) as Record<string, any>[]).map((x) => ({
    id: x.reference || fmtId("EXP", x.id), category: x.category, amount: r(x.amount), account: x.account, date: bizDate(x.ts, off), notes: x.description ?? "", user: x.usr ?? "",
  }))

  const label = (src: string | null, id: number | null) => docLabel(db, src, id)

  const entries = (db.prepare(`SELECT e.id, e.ts, e.amount, e.kind, e.description, e.source_type, e.source_id, a.name AS account FROM account_entries e JOIN accounts a ON a.id = e.account_id WHERE e.ts >= ? ORDER BY e.ts DESC, e.id DESC LIMIT 6000`).all(since) as Record<string, any>[]).map((e) => ({
    id: label(e.source_type, e.source_id) || fmtId("ENT", e.id), date: bizDate(e.ts, off), account: e.account, description: e.description ?? "", incoming: e.amount > 0 ? r(e.amount) : 0, outgoing: e.amount < 0 ? r(-e.amount) : 0, type: ENTRY_LABEL[e.kind] ?? e.kind,
  }))

  const accounts: Record<string, number> = {}
  for (const a of db.prepare(`SELECT a.name, COALESCE(b.balance,0) AS bal FROM accounts a LEFT JOIN v_account_balance b ON b.account_id = a.id WHERE a.active = 1 ORDER BY a.id`).all() as { name: string; bal: number }[]) accounts[a.name] = r(a.bal)

  const users = (db.prepare("SELECT u.id, u.username, u.display_name, u.active, u.last_login_at, ro.name AS role FROM users u JOIN roles ro ON ro.id = u.role_id ORDER BY u.id").all() as Record<string, any>[]).map((u) => ({
    id: fmtId("USR", u.id), name: u.display_name, username: u.username, role: u.role, status: u.active ? "Active" : "Inactive",
    activity: u.last_login_at ? `Last sign-in ${bizDate(u.last_login_at, off)} ${bizTime(u.last_login_at, off)}` : "Not yet signed in",
  }))

  const audits: Audit[] = (db.prepare(`SELECT l.id, l.ts, l.action, l.detail, u.display_name AS usr FROM audit_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 600`).all() as Record<string, any>[]).map((l) => {
    let d: Record<string, unknown> = {}
    try { d = l.detail ? JSON.parse(l.detail) : {} } catch { d = {} }
    const t = auditText(l.action, d)
    return { id: fmtId("LOG", l.id), date: `${bizDate(l.ts, off)} ${bizTime(l.ts, off)}`, action: t.action, detail: t.detail, user: l.usr ?? "System" }
  })

  const returns = [
    ...(db.prepare(`SELECT r.return_no AS id, COALESCE(s.invoice_no,'No invoice') AS original, r.total, r.ts, p.name AS party FROM sale_returns r LEFT JOIN sales s ON s.id = r.sale_id JOIN parties p ON p.id = r.party_id WHERE r.ts >= ?`).all(since) as Record<string, any>[]).map((x) => ({ id: x.id, original: x.original, type: "Sale return", total: r(x.total), date: bizDate(x.ts, off), party: x.party, ts: x.ts as string })),
    ...(db.prepare(`SELECT r.return_no AS id, s.purchase_no AS original, r.total, r.ts, p.name AS party FROM purchase_returns r JOIN purchases s ON s.id = r.purchase_id JOIN suppliers p ON p.id = r.supplier_id WHERE r.ts >= ?`).all(since) as Record<string, any>[]).map((x) => ({ id: x.id, original: x.original, type: "Purchase return", total: r(x.total), date: bizDate(x.ts, off), party: x.party, ts: x.ts as string })),
  ].sort((a, b) => b.ts.localeCompare(a.ts)).map(({ ts: _ts, ...rest }) => rest)

  const closings = (db.prepare(`SELECT c.id, c.business_date, c.expected, c.counted, c.variance, c.notes, a.name AS account, u.display_name AS usr FROM cash_closings c JOIN accounts a ON a.id = c.account_id LEFT JOIN users u ON u.id = c.user_id ORDER BY c.business_date DESC, c.id DESC LIMIT 400`).all() as Record<string, any>[]).map((c) => ({
    id: fmtId("CLS", c.id), date: c.business_date, account: c.account, expected: r(c.expected), counted: r(c.counted), variance: r(c.variance), notes: c.notes ?? "", user: c.usr ?? "",
  }))

  return {
    today, historyFrom, walkInId: walk ? fmtId("PTY", walk.id) : "",
    parties, suppliers, collections, supplierPayments, expenses, accounts, entries, users, audits, returns, closings,
    masters: buildMasters(db),
    dashboard: buildDashboard(db, today),
  }
}
