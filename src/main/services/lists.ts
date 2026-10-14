import type { DB } from "../db/connection"
import { getSetting } from "../db/util"
import { fmtId, idNumber, type CartItem, type Movement, type Product, type Transaction } from "@shared/models"
import { bizDate, bizTime, docLabel } from "./snapshot"
import { balanceAround } from "./queries"

/**
 * Server-side lists. The renderer never holds the whole catalogue or the whole history: it asks for one
 * page at a time, so a shop with tens of thousands of items opens and searches instantly.
 */
const r = (minor: number) => minor / 100
const offsetMinutes = (db: DB) => Number(getSetting(db, "timezone_offset_minutes", "300"))

export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}
const clampPage = (page: number | undefined, pageSize: number | undefined) => {
  const size = Math.min(Math.max(Math.trunc(pageSize ?? 50), 1), 500)
  const p = Math.max(Math.trunc(page ?? 1), 1)
  return { size, p, offset: (p - 1) * size }
}
const esc = (s: string) => s.replace(/[\\%_]/g, (m) => `\\${m}`)
const tokens = (q?: string) => (q ?? "").trim().split(/\s+/).filter(Boolean).slice(0, 8)

// ---------------------------------------------------------------- products
export type ProductStatus = "all" | "in" | "low" | "out" | "inactive"
export interface ProductQuery {
  query?: string
  status?: ProductStatus
  page?: number
  pageSize?: number
  /** Only items that can be sold / bought (the POS and purchase screens). */
  activeOnly?: boolean
  /** Fetch exactly these items (display ids such as "VAR-0007"). */
  ids?: string[]
}

const PRODUCT_SELECT = `
  SELECT v.*, i.name AS article, co.name AS company, COALESCE(cat.name,'') AS category, COALESCE(sl.qty,0) AS stock,
         COALESCE(sl.avg_cost,0) AS avg_cost,
         (SELECT MIN(b.expiry_date) FROM batches b WHERE b.variant_id = v.id AND b.expiry_date IS NOT NULL
            AND (SELECT COALESCE(SUM(m.qty_delta),0) FROM stock_movements m WHERE m.batch_id = b.id) > 0) AS expiry
  FROM variants v JOIN items i ON i.id = v.item_id JOIN companies co ON co.id = i.company_id
  LEFT JOIN categories cat ON cat.id = i.category_id LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.warehouse_id = 1`

function wholesaleOn(db: DB): boolean {
  return (db.prepare("SELECT enabled FROM feature_flags WHERE key = 'wholesalePrice'").get() as { enabled: number } | undefined)?.enabled === 1
}

export function mapProduct(v: Record<string, any>, wholesale: boolean): Product {
  return {
    id: fmtId("VAR", v.id),
    name: `${v.article}${v.color ? " " + v.color : ""}`,
    company: v.company,
    category: v.category,
    article: v.article,
    color: v.color ?? "",
    design: v.design ?? "",
    size: v.size_label ?? "",
    unit: v.unit,
    barcode: v.barcode ?? "",
    sku: v.sku ?? "",
    stock: v.stock,
    cost: r(v.avg_cost || v.purchase_price),
    rate: r(v.sale_price),
    price: r(wholesale && v.wholesale_price != null ? v.wholesale_price : v.sale_price),
    wholesale: v.wholesale_price == null ? undefined : r(v.wholesale_price),
    minStock: v.min_stock,
    expiry: v.expiry ?? undefined,
    active: !!v.active,
    image: v.image ?? undefined,
  }
}

function productWhere(q: ProductQuery): { where: string; args: unknown[] } {
  const parts: string[] = []
  const args: unknown[] = []
  if (q.activeOnly) parts.push("v.active = 1")
  switch (q.status) {
    case "inactive": parts.push("v.active = 0"); break
    case "in": parts.push("COALESCE(sl.qty,0) > 0 AND COALESCE(sl.qty,0) > v.min_stock"); break
    case "out": parts.push("COALESCE(sl.qty,0) <= 0"); break
    case "low": parts.push("COALESCE(sl.qty,0) > 0 AND COALESCE(sl.qty,0) <= v.min_stock"); break
  }
  if (q.ids?.length) {
    const nums = q.ids.map((id) => idNumber(id))
    parts.push(`v.id IN (${nums.map(() => "?").join(",")})`)
    args.push(...nums)
  }
  for (const t of tokens(q.query)) {
    const like = `%${esc(t)}%`
    const m = /^VAR-0*(\d+)$/i.exec(t)
    parts.push(
      `(i.name LIKE ? ESCAPE '\\' OR v.color LIKE ? ESCAPE '\\' OR co.name LIKE ? ESCAPE '\\' OR cat.name LIKE ? ESCAPE '\\' OR v.sku LIKE ? ESCAPE '\\' OR v.barcode LIKE ? ESCAPE '\\' OR v.size_label LIKE ? ESCAPE '\\' OR v.design LIKE ? ESCAPE '\\'${m ? " OR v.id = ?" : ""})`,
    )
    args.push(like, like, like, like, like, like, like, like)
    if (m) args.push(Number(m[1]))
  }
  return { where: parts.length ? `WHERE ${parts.join(" AND ")}` : "", args }
}

export function listProducts(db: DB, q: ProductQuery): Page<Product> {
  const { size, p, offset } = clampPage(q.page, q.pageSize)
  const { where, args } = productWhere(q)
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM variants v JOIN items i ON i.id = v.item_id JOIN companies co ON co.id = i.company_id LEFT JOIN categories cat ON cat.id = i.category_id LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.warehouse_id = 1 ${where}`).get(...args) as { n: number }).n
  // A scanned barcode / exact SKU always comes first.
  const exact = (q.query ?? "").trim()
  const rows = db
    .prepare(`${PRODUCT_SELECT} ${where} ORDER BY (v.barcode = ? OR v.sku = ?) DESC, co.name, i.name, v.color, v.id LIMIT ? OFFSET ?`)
    .all(...args, exact, exact, size, offset) as Record<string, any>[]
  const w = wholesaleOn(db)
  return { rows: rows.map((x) => mapProduct(x, w)), total, page: p, pageSize: size }
}

export interface InventorySummary {
  items: number
  units: number
  value: number
  low: number
  out: number
  /** Active items at or below their minimum stock (includes out of stock). */
  reorder: number
}
export function inventorySummary(db: DB): InventorySummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS items, COALESCE(SUM(CASE WHEN COALESCE(sl.qty,0) > 0 THEN sl.qty ELSE 0 END),0) AS units,
              COALESCE(SUM(CASE WHEN COALESCE(sl.qty,0) > 0 THEN sl.value ELSE 0 END),0) AS value,
              COALESCE(SUM(CASE WHEN COALESCE(sl.qty,0) > 0 AND sl.qty <= v.min_stock THEN 1 ELSE 0 END),0) AS low,
              COALESCE(SUM(CASE WHEN COALESCE(sl.qty,0) <= 0 THEN 1 ELSE 0 END),0) AS out,
              COALESCE(SUM(CASE WHEN COALESCE(sl.qty,0) <= v.min_stock THEN 1 ELSE 0 END),0) AS reorder
       FROM variants v LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.warehouse_id = 1 WHERE v.active = 1`,
    )
    .get() as { items: number; units: number; value: number; low: number; out: number; reorder: number }
  return { items: row.items, units: row.units, value: r(row.value), low: row.low, out: row.out, reorder: row.reorder }
}

// ---------------------------------------------------------------- documents
export interface DocQuery {
  kind: "sale" | "purchase"
  query?: string
  status?: "all" | "completed" | "void"
  page?: number
  pageSize?: number
  /** Fetch one document by its number (INV-00012). */
  no?: string
  /** Only documents of this party (display id). */
  partyId?: string
  /** Payment status filter used by the history screens. */
  payment?: "paid" | "partial" | "unpaid"
}
export interface DocPage extends Page<Transaction> {
  summary: { count: number; total: number; paid: number }
}

export function docRows(db: DB, kind: "sale" | "purchase", rows: Record<string, any>[]): Transaction[] {
  if (rows.length === 0) return []
  const off = offsetMinutes(db)
  const sale = kind === "sale"
  const ids = rows.map((x) => x.id)
  const marks = ids.map(() => "?").join(",")
  const lines = db
    .prepare(
      sale
        ? `SELECT l.sale_id AS doc, l.variant_id, l.qty, l.rate, l.discount, l.size_label, i.name AS article, v.color FROM sale_lines l JOIN variants v ON v.id = l.variant_id JOIN items i ON i.id = v.item_id WHERE l.sale_id IN (${marks}) ORDER BY l.id`
        : `SELECT l.purchase_id AS doc, l.variant_id, l.qty, l.rate, l.discount, v.size_label, i.name AS article, v.color FROM purchase_lines l JOIN variants v ON v.id = l.variant_id JOIN items i ON i.id = v.item_id WHERE l.purchase_id IN (${marks}) ORDER BY l.id`,
    )
    .all(...ids) as Record<string, any>[]
  const byDoc = new Map<number, CartItem[]>()
  for (const l of lines) {
    const arr = byDoc.get(l.doc) ?? []
    arr.push({ productId: fmtId("VAR", l.variant_id), name: `${l.article}${l.color ? " " + l.color : ""}`, color: l.color ?? "", size: l.size_label ?? "", qty: l.qty, rate: r(l.rate), discount: r(l.discount) })
    byDoc.set(l.doc, arr)
  }
  const pays = db
    .prepare(
      sale
        ? `SELECT sale_id AS doc, a.name AS account, sp.method FROM sale_payments sp JOIN accounts a ON a.id = sp.account_id WHERE sale_id IN (${marks}) ORDER BY sp.id`
        : `SELECT purchase_id AS doc, a.name AS account, sp.method FROM purchase_payments sp JOIN accounts a ON a.id = sp.account_id WHERE purchase_id IN (${marks}) ORDER BY sp.id`,
    )
    .all(...ids) as { doc: number; account: string; method: string }[]
  const firstPay = new Map<number, { account: string; method: string }>()
  for (const p of pays) if (!firstPay.has(p.doc)) firstPay.set(p.doc, p)
  const walkIns = new Set<number>()
  if (sale) for (const w of db.prepare("SELECT id FROM parties WHERE is_walk_in = 1").all() as { id: number }[]) walkIns.add(w.id)
  return rows.map((x) => {
    const ls = byDoc.get(x.id) ?? []
    const fp = firstPay.get(x.id)
    const lineDisc = ls.reduce((s, l) => s + l.discount, 0)
    return {
      id: x.no,
      party: x.party,
      partyId: fmtId(sale ? "PTY" : "SUP", x.pid),
      date: bizDate(x.ts, off),
      time: bizTime(x.ts, off),
      items: ls.reduce((s, l) => s + l.qty, 0),
      total: r(x.total),
      paid: r(x.paid),
      method: x.paid === 0 ? "Credit" : x.paid >= x.total ? (fp?.method ?? "Cash") : "Partial",
      lines: ls,
      account: fp?.account,
      supplierInvoice: x.sinv ?? undefined,
      invoiceDiscount: Math.max(0, Math.round((r(x.discount) - lineDisc) * 100) / 100),
      status: x.status,
      kind,
      user: x.usr ?? "",
      walkIn: walkIns.has(x.pid),
      ...(walkIns.has(x.pid) ? {} : balanceAround(db, sale ? "customer" : "supplier", x.pid, sale ? "sale" : "purchase", x.id)),
    } as Transaction
  })
}

export function listDocs(db: DB, q: DocQuery): DocPage {
  const sale = q.kind === "sale"
  const { size, p, offset } = clampPage(q.page, q.pageSize)
  const parts: string[] = []
  const args: unknown[] = []
  const noCol = sale ? "s.invoice_no" : "s.purchase_no"
  if (q.no) { parts.push(`${noCol} = ?`); args.push(q.no) }
  if (q.status && q.status !== "all") { parts.push("s.status = ?"); args.push(q.status) }
  if (q.payment === "paid") parts.push("s.paid >= s.total")
  if (q.payment === "partial") parts.push("s.paid > 0 AND s.paid < s.total")
  if (q.payment === "unpaid") parts.push("s.paid = 0")
  if (q.partyId) { parts.push(sale ? "s.party_id = ?" : "s.supplier_id = ?"); args.push(idNumber(q.partyId)) }
  for (const t of tokens(q.query)) {
    const like = `%${esc(t)}%`
    parts.push(`(${noCol} LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\'${sale ? "" : " OR s.supplier_invoice_no LIKE ? ESCAPE '\\'"})`)
    args.push(like, like)
    if (!sale) args.push(like)
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : ""
  const from = sale
    ? `FROM sales s JOIN parties p ON p.id = s.party_id LEFT JOIN users u ON u.id = s.user_id`
    : `FROM purchases s JOIN suppliers p ON p.id = s.supplier_id LEFT JOIN users u ON u.id = s.user_id`
  const sum = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN s.status='completed' THEN s.total ELSE 0 END),0) AS total, COALESCE(SUM(CASE WHEN s.status='completed' THEN s.paid ELSE 0 END),0) AS paid ${from} ${where}`).get(...args) as { n: number; total: number; paid: number }
  const rows = db
    .prepare(
      `SELECT s.id, ${noCol} AS no, s.ts, ${sale ? "s.party_id" : "s.supplier_id"} AS pid, p.name AS party, s.subtotal, s.discount, s.total, s.paid, s.status, ${sale ? "NULL" : "s.supplier_invoice_no"} AS sinv, u.display_name AS usr
       ${from} ${where} ORDER BY s.ts DESC, s.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, size, offset) as Record<string, any>[]
  return { rows: docRows(db, q.kind, rows), total: sum.n, page: p, pageSize: size, summary: { count: sum.n, total: r(sum.total), paid: r(sum.paid) } }
}

// ---------------------------------------------------------------- stock movements
const MOVEMENT_LABEL: Record<string, string> = {
  opening: "Opening stock", purchase: "Purchase", sale: "Sale", sale_return: "Sale return", purchase_return: "Purchase return",
  sale_void: "Sale void", purchase_void: "Purchase void", damage: "Damage", adjustment_in: "Adjustment", adjustment_out: "Adjustment",
}
export function listMovements(db: DB, q: { productId?: string; page?: number; pageSize?: number }): Page<Movement> {
  const { size, p, offset } = clampPage(q.page, q.pageSize)
  const where = q.productId ? "WHERE m.variant_id = ?" : ""
  const args = q.productId ? [idNumber(q.productId)] : []
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM stock_movements m ${where}`).get(...args) as { n: number }).n
  const off = offsetMinutes(db)
  const rows = (db.prepare(`SELECT m.id, m.ts, m.variant_id, m.qty_delta, m.type, m.source_type, m.source_id, m.note FROM stock_movements m ${where} ORDER BY m.ts DESC, m.id DESC LIMIT ? OFFSET ?`).all(...args, size, offset) as Record<string, any>[]).map((m) => ({
    id: docLabel(db, m.source_type, m.source_id) || fmtId("MOV", m.id),
    date: bizDate(m.ts, off),
    type: MOVEMENT_LABEL[m.type] ?? m.type,
    quantity: m.qty_delta,
    productId: fmtId("VAR", m.variant_id),
    reason: m.note ?? "",
  }))
  return { rows, total, page: p, pageSize: size }
}
